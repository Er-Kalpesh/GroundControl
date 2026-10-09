import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { isPortFree } from '../../src/core/ports.js';
import { Orchestrator, PortInUseError, PolicyError } from '../../src/core/orchestrator.js';
import { ProcessManager } from '../../src/core/process-manager.js';
import { StateFile, isAlive } from '../../src/core/state-file.js';
import { AuditLog } from '../../src/core/audit.js';
import { waitFor, getFreePort } from '../helpers.js';

const fx = (n: string) => resolve('tests/fixtures', n);
const human = { kind: 'human', name: 'test' } as const;
const ai = { kind: 'ai', name: 'test-ai' } as const;
let dir: string, pm: ProcessManager, orch: Orchestrator;

function writeCfg(name: string, body: object) {
  const d = mkdtempSync(join(dir, name + '-')); const f = join(d, 'groundcontrol.json');
  writeFileSync(f, JSON.stringify({ version: 1, ...body })); return f;
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gc-orch-'));
  pm = new ProcessManager({ stateFile: new StateFile(join(dir, 'state.json')), logsDir: join(dir, 'logs') });
  orch = new Orchestrator({ pm, audit: new AuditLog(join(dir, 'audit.log')), registryFile: join(dir, 'projects.json') });
});
afterEach(async () => { orch.dispose(); await pm.shutdown({ killChildren: true }); rmSync(dir, { recursive: true, force: true }); });

describe('Orchestrator', () => {
  it('starts dependencies first and waits for readiness', async () => {
    const dbPort = await getFreePort(), apiPort = await getFreePort();
    orch.registerProject(writeCfg('a', { project: 'a', services: {
      db:  { command: `node ${fx('echo-server.mjs')}`, port: dbPort, health: { type: 'tcp', port: dbPort, intervalMs: 50 } },
      api: { command: `node ${fx('echo-server.mjs')}`, port: apiPort, dependsOn: ['db'],
             health: { type: 'http', url: `http://127.0.0.1:${apiPort}/`, intervalMs: 50 } } } }));
    const out = await orch.up('a', human);
    expect(out.map(s => [s.name, s.state])).toEqual([['db', 'ready'], ['api', 'ready']]);
    const s = await orch.statuses('a');
    expect(s.find(x => x.name === 'db')!.startedAt!).toBeLessThanOrEqual(s.find(x => x.name === 'api')!.startedAt!);
  });

  it('throws PortInUseError before spawning anything', async () => {
    const port = await getFreePort(); const blocker = net.createServer().listen(port, '127.0.0.1');
    await new Promise(r => blocker.once('listening', r));
    orch.registerProject(writeCfg('b', { project: 'b', services: { s: { command: `node ${fx('echo-server.mjs')}`, port } } }));
    await expect(orch.startService('b/s', human)).rejects.toBeInstanceOf(PortInUseError);
    expect(pm.status()).toEqual([]);
    blocker.close();
  });

  it('up({killZombies}) removes a foreign listener first', async () => {
    const port = await getFreePort();
    const foreign = spawn(process.execPath, ['-e', `require('net').createServer().listen(${port},'127.0.0.1');setInterval(()=>{},1000)`], { stdio: 'ignore' });
    await waitFor(async () => !(await isPortFree(port)));
    orch.registerProject(writeCfg('z', { project: 'z', services: { s: { command: `node ${fx('echo-server.mjs')}`, port } } }));
    await expect(orch.up('z', human)).rejects.toBeInstanceOf(PortInUseError);
    const out = await orch.up('z', human, undefined, { killZombies: true });
    expect(out[0]!.state).toBe('ready'); foreign.kill();
  });

  it('down stops in reverse order and leaves no process alive', async () => {
    const p1 = await getFreePort(), p2 = await getFreePort();
    orch.registerProject(writeCfg('c', { project: 'c', services: {
      one: { command: `node ${fx('echo-server.mjs')}`, port: p1 },
      two: { command: `node ${fx('echo-server.mjs')}`, port: p2, dependsOn: ['one'] } } }));
    await orch.up('c', human);
    const pids = pm.status().map(s => s.pid!);
    const stopped: string[] = []; pm.on('state', s => { if (s.state === 'stopped') stopped.push(s.name); });
    await orch.down('c', human);
    expect(stopped).toEqual(['two', 'one']);
    for (const pid of pids) expect(isAlive(pid)).toBe(false);
  });

  it('auto-restarts a crashing service up to maxRetries, then stays crashed', async () => {
    orch.registerProject(writeCfg('d', { project: 'd', services: { s: {
      command: `node -e "process.exit(1)"`, restart: { policy: 'on-failure', maxRetries: 2, backoffMs: 100 } } } }));
    await orch.startService('d/s', human);
    await waitFor(() => { const s = pm.status('d/s')[0]!; return s.state === 'crashed' && s.restarts === 2; }, 20000);
    await new Promise(r => setTimeout(r, 600));
    expect(pm.status('d/s')[0]!.restarts).toBe(2);   // no third restart
  });

  it('resets the retry counter once a service has stayed ready for stableMs', async () => {
    orch.dispose();
    orch = new Orchestrator({ pm, audit: new AuditLog(join(dir, 'audit-s.log')), stableMs: 200 });
    orch.registerProject(writeCfg('s', { project: 's', services: { s: {
      command: `node -e "setTimeout(()=>process.exit(1),1200)"`, restart: { policy: 'on-failure', maxRetries: 1, backoffMs: 100 } } } }));
    let starts = 0; pm.on('state', st => { if (st.id === 's/s' && st.state === 'running') starts++; });
    await orch.startService('s/s', human);
    await waitFor(() => starts >= 3, 10000);          // with maxRetries=1 a third run is only possible if the counter was reset
  });

  it('does not restart after a user stop', async () => {
    orch.registerProject(writeCfg('e', { project: 'e', services: { s: {
      command: `node ${fx('echo-server.mjs')}`, restart: { policy: 'always', maxRetries: 5, backoffMs: 100 } } } }));
    await orch.startService('e/s', human);
    await orch.stopService('e/s', human);
    await new Promise(r => setTimeout(r, 400));
    expect(pm.status('e/s')[0]!.state).toBe('stopped');
  });

  it('keeps same-named services in different projects apart', () => {
    orch.registerProject(writeCfg('f1', { project: 'p1', services: { web: { command: 'x' } } }));
    orch.registerProject(writeCfg('f2', { project: 'p2', services: { web: { command: 'x' } } }));
    expect(orch.listProjects().map(p => p.project).sort()).toEqual(['p1', 'p2']);
  });

  it('up(only) includes transitive dependencies', async () => {
    const pa = await getFreePort(), pb = await getFreePort(), pc = await getFreePort();
    orch.registerProject(writeCfg('g', { project: 'g', services: {
      a: { command: `node ${fx('echo-server.mjs')}`, port: pa },
      b: { command: `node ${fx('echo-server.mjs')}`, port: pb, dependsOn: ['a'] },
      c: { command: `node ${fx('echo-server.mjs')}`, port: pc } } }));
    await orch.up('g', human, ['b']);
    expect(pm.status().map(s => s.name).sort()).toEqual(['a', 'b']);
  });

  it('up() aborts when a dependency fails readiness', async () => {
    orch.registerProject(writeCfg('h', { project: 'h', services: {
      bad:  { command: `node -e "setInterval(()=>{},1000)"`, health: { type: 'log', pattern: 'never-appears', timeoutMs: 400 } },
      next: { command: `node ${fx('echo-server.mjs')}`, dependsOn: ['bad'] } } }));
    await expect(orch.up('h', human)).rejects.toThrow(/h\/bad failed/);
    expect(pm.status().map(s => s.name)).toEqual(['bad']);
  });

  it('AI callers cannot run arbitrary commands by default but can run declared tasks', async () => {
    orch.registerProject(writeCfg('i', { project: 'i', services: {}, tasks: { hello: { command: 'echo hi' } } }));
    await expect(orch.runTask('i', { command: 'echo pwned' }, ai)).rejects.toBeInstanceOf(PolicyError);
    const r = await orch.runTask('i', { task: 'hello' }, ai);
    expect(r.stdout.trim()).toBe('hi'); expect(r.exitCode).toBe(0);
    expect((await orch.runTask('i', { command: 'echo ok' }, human)).stdout.trim()).toBe('ok');
  });

  it('restoreProjects re-registers projects from the registry file', () => {
    const f = writeCfg('j', { project: 'j', services: { s: { command: 'x' } } });
    orch.registerProject(f);
    const orch2 = new Orchestrator({ pm, audit: new AuditLog(join(dir, 'audit2.log')), registryFile: join(dir, 'projects.json') });
    orch2.restoreProjects();
    expect(orch2.listProjects().map(p => p.project)).toEqual(['j']);
  });
});
