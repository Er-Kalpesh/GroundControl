import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProcessManager } from '../../src/core/process-manager.js';
import { StateFile, isAlive } from '../../src/core/state-file.js';
import { parseConfig } from '../../src/config/load.js';
import { waitFor } from '../helpers.js';

const fx = (n: string) => resolve('tests/fixtures', n);
function setup(command: string, extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gc-'));
  const cfg = parseConfig({ version: 1, project: 'p', services: { s: { command, ...extra } } }, join(dir, 'groundcontrol.json'));
  const pm = new ProcessManager({ stateFile: new StateFile(join(dir, 'state.json')), logsDir: join(dir, 'logs') });
  return { dir, cfg: cfg.services.s!, pm };
}
let pms: ProcessManager[] = [];
afterEach(async () => { for (const p of pms.splice(0)) await p.shutdown({ killChildren: true }); });

describe('ProcessManager', () => {
  it('starts, captures logs, stops', async () => {
    const { cfg, pm } = setup(`node ${fx('echo-server.mjs')}`); pms.push(pm);
    const st = await pm.start('p/s', 'p', 's', cfg);
    expect(st.state).toBe('running'); expect(st.pid).toBeGreaterThan(0);
    await waitFor(() => pm.logs('p/s')!.tail(10).join('\n').includes('tick'));
    await pm.stop('p/s');
    expect(pm.status('p/s')[0]!.state).toBe('stopped');
    expect(isAlive(st.pid!)).toBe(false);
  });
  it('emits state events in order', async () => {
    const { cfg, pm } = setup(`node ${fx('echo-server.mjs')}`); pms.push(pm);
    const seen: string[] = []; pm.on('state', s => seen.push(s.state));
    await pm.start('p/s', 'p', 's', cfg); await pm.stop('p/s');
    expect(seen[0]).toBe('running'); expect(seen).toContain('stopping'); expect(seen.at(-1)).toBe('stopped');
  });
  it('kills grandchildren via the process group', async () => {
    const { cfg, pm } = setup(`node ${fx('spawns-child.mjs')}`); pms.push(pm);
    await pm.start('p/s', 'p', 's', cfg);
    await waitFor(() => /child \d+/.test(pm.logs('p/s')!.tail(5).join('\n')));
    const gc = Number(pm.logs('p/s')!.tail(5).join('\n').match(/child (\d+)/)![1]);
    expect(isAlive(gc)).toBe(true);
    await pm.stop('p/s');
    expect(isAlive(gc)).toBe(false);
  });
  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const { cfg, pm } = setup(`node -e "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"`, { stopTimeoutMs: 500 }); pms.push(pm);
    const st = await pm.start('p/s', 'p', 's', cfg);
    await new Promise(r => setTimeout(r, 300));
    await pm.stop('p/s');
    expect(isAlive(st.pid!)).toBe(false);
  });
  it('marks a non-zero exit as crashed with the exit code', async () => {
    const { cfg, pm } = setup(`node -e "process.exit(3)"`); pms.push(pm);
    await pm.start('p/s', 'p', 's', cfg);
    await waitFor(() => pm.status('p/s')[0]!.state === 'crashed');
    expect(pm.status('p/s')[0]!.exitCode).toBe(3);
  });
  it('marks a clean exit as stopped', async () => {
    const { cfg, pm } = setup(`node -e "process.exit(0)"`); pms.push(pm);
    await pm.start('p/s', 'p', 's', cfg);
    await waitFor(() => pm.status('p/s')[0]!.state === 'stopped');
  });
  it('emits exactly one exit event per run', async () => {
    const { cfg, pm } = setup(`node ${fx('echo-server.mjs')}`); pms.push(pm);
    let n = 0; pm.on('exit', () => n++);
    await pm.start('p/s', 'p', 's', cfg); await pm.stop('p/s');
    await new Promise(r => setTimeout(r, 300));
    expect(n).toBe(1);
  });
  it('refuses to start a service twice', async () => {
    const { cfg, pm } = setup(`node ${fx('echo-server.mjs')}`); pms.push(pm);
    await pm.start('p/s', 'p', 's', cfg);
    await expect(pm.start('p/s', 'p', 's', cfg)).rejects.toThrow(/already running/);
  });
  it('can start again after a stop and keeps the restart counter', async () => {
    const { cfg, pm } = setup(`node ${fx('echo-server.mjs')}`); pms.push(pm);
    await pm.start('p/s', 'p', 's', cfg); pm.setRestarts('p/s', 2); await pm.stop('p/s');
    const again = await pm.start('p/s', 'p', 's', cfg);
    expect(again.state).toBe('running'); expect(again.restarts).toBe(2);
  });
  it('passes PORT and env to the child', async () => {
    const { cfg, pm } = setup(`node -e "console.log('P='+process.env.PORT+' X='+process.env.X)"`, { port: 4321, env: { X: 'y' } }); pms.push(pm);
    await pm.start('p/s', 'p', 's', cfg);
    await waitFor(() => pm.logs('p/s')!.tail(5).join('').includes('P=4321 X=y'));
  });
  it('markReady only transitions a running service', async () => {
    const { cfg, pm } = setup(`node ${fx('echo-server.mjs')}`); pms.push(pm);
    await pm.start('p/s', 'p', 's', cfg);
    pm.markReady('p/s', { ok: true }); expect(pm.status('p/s')[0]!.state).toBe('ready');
    pm.markReady('p/s', { ok: false, reason: 'later failure' }); expect(pm.status('p/s')[0]!.state).toBe('ready');
    await pm.stop('p/s'); pm.markReady('p/s', { ok: true }); expect(pm.status('p/s')[0]!.state).toBe('stopped');
  });
  it('re-adopts a live service after a new manager boots (daemon restart)', async () => {
    const { dir, cfg, pm } = setup(`node ${fx('echo-server.mjs')}`);
    const st = await pm.start('p/s', 'p', 's', cfg);
    await pm.shutdown({ killChildren: false });                                   // simulate daemon exit
    const pm2 = new ProcessManager({ stateFile: new StateFile(join(dir, 'state.json')), logsDir: join(dir, 'logs') });
    pms.push(pm2); pm2.adoptAll();
    const s = pm2.status('p/s')[0]!;
    expect(s.pid).toBe(st.pid); expect(s.state).toBe('running');
    await waitFor(() => pm2.logs('p/s')!.tail(5).length > 0);                      // log history is available
    await pm2.stop('p/s');
    expect(isAlive(st.pid!)).toBe(false);
    expect(pm2.status('p/s')[0]!.state).toBe('stopped');
  });
  it('does not adopt a dead service', async () => {
    const { dir, cfg, pm } = setup(`node ${fx('echo-server.mjs')}`);
    await pm.start('p/s', 'p', 's', cfg); await pm.stop('p/s');
    const pm2 = new ProcessManager({ stateFile: new StateFile(join(dir, 'state.json')), logsDir: join(dir, 'logs') });
    pms.push(pm2); pm2.adoptAll();
    expect(pm2.status()).toEqual([]);
  });
  it('detects an adopted service dying on its own', async () => {
    const { dir, cfg, pm } = setup(`node -e "setInterval(()=>{},1000)"`);
    const st = await pm.start('p/s', 'p', 's', cfg);
    await pm.shutdown({ killChildren: false });
    const pm2 = new ProcessManager({ stateFile: new StateFile(join(dir, 'state.json')), logsDir: join(dir, 'logs') });
    pms.push(pm2); pm2.adoptAll();
    process.kill(-st.pid!, 'SIGKILL');
    await waitFor(() => pm2.status('p/s')[0]!.state === 'crashed', 5000);
  });
});
