import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { isAlive } from '../../src/core/state-file.js';
import { getFreePort } from '../helpers.js';

let home: string, port: number, projDir: string, env: Record<string, string>, webPort: number;
const bin = resolve('dist/cli/index.js');
const gc = (args: string[], cwd = projDir) => spawnSync(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8' });
const ok = (args: string[], cwd = projDir) => { const r = gc(args, cwd); if (r.status !== 0) throw new Error(`gc ${args.join(' ')} -> ${r.status}\n${r.stdout}\n${r.stderr}`); return r.stdout; };

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'gc-cli-')); port = await getFreePort(); webPort = await getFreePort(); projDir = mkdtempSync(join(tmpdir(), 'gc-cliproj-'));
  writeFileSync(join(projDir, 'groundcontrol.json'), JSON.stringify({ version: 1, project: 'cli', services: {
    web: { command: `node ${resolve('tests/fixtures/echo-server.mjs')}`, port: webPort, health: { type: 'tcp', port: webPort, intervalMs: 50 } } },
    tasks: { hello: { command: 'echo hello-task' } } }));
  env = { ...process.env as Record<string, string>, GROUNDCONTROL_HOME: home, GROUNDCONTROL_PORT: String(port), GROUNDCONTROL_SKIP_SHELL_PATH: '1' };
});
afterAll(() => {
  try { gc(['stop']); process.kill(Number(readFileSync(join(home, 'daemon.pid'), 'utf8')), 'SIGTERM'); } catch { /* none */ }
  rmSync(home, { recursive: true, force: true });
});

describe('CLI e2e', () => {
  it('init writes a valid starter config and refuses to overwrite', () => {
    const d = mkdtempSync(join(tmpdir(), 'gc-init-')); writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '5' } }));
    ok(['init'], d);
    expect(JSON.parse(readFileSync(join(d, 'groundcontrol.json'), 'utf8')).services.web.port).toBe(5173);
    const again = gc(['init'], d); expect(again.status).toBe(1); expect(again.stderr).toContain('already exists');
    expect(gc(['init', '--force'], d).status).toBe(0);
  });
  it('status before start shows a stopped service (--json)', () => {
    const j = JSON.parse(ok(['--json', 'status']));
    expect(j.services.map((s: any) => [s.id, s.state])).toEqual([['cli/web', 'stopped']]);
  });
  it('start brings it up, status/logs/ports/run work', async () => {
    expect(ok(['start'])).toContain('ready');
    expect(ok(['status'])).toContain('cli/web');
    expect(ok(['ports', String(webPort)])).toMatch(/used by/);
    expect(ok(['run', 'hello'])).toContain('hello-task');
    expect(ok(['run', 'echo adhoc'])).toContain('adhoc');                // humans may run arbitrary commands
    await new Promise(r => setTimeout(r, 600));
    expect(ok(['logs', 'web', '-n', '5'])).toContain('tick');
  });
  it('start reports a busy port with the owner and a hint', async () => {
    ok(['stop']);
    const blocker = net.createServer().listen(webPort, '127.0.0.1'); await new Promise(r => blocker.once('listening', r));
    const r = gc(['start']); expect(r.status).toBe(1);
    expect(r.stderr).toContain(`port ${webPort} is in use`); expect(r.stderr).toContain('--kill-zombies');
    blocker.close(); await new Promise(r => setTimeout(r, 100));
  });
  it('doctor runs and daemon stop keeps services alive', () => {
    ok(['start']);
    expect(ok(['doctor'])).toContain('groundcontrol.json valid');
    const pid = JSON.parse(ok(['--json', 'status'])).services[0].pid as number;
    expect(ok(['daemon', 'stop'])).toContain('services keep running');
    expect(isAlive(pid)).toBe(true);
    expect(ok(['daemon', 'status'])).toContain('not running');
    expect(JSON.parse(ok(['--json', 'status'])).services[0].pid).toBe(pid);       // new daemon adopted it
    ok(['stop']); expect(isAlive(pid)).toBe(false);
  });
  it('ui --no-open prints the dashboard URL with the token fragment', () => {
    const o = ok(['ui', '--no-open']);
    expect(o).toContain(`http://127.0.0.1:${port}/#token=`); expect(existsSync(join(home, 'token'))).toBe(true);
  });
  it('unknown project directory gives a helpful error', () => {
    const empty = mkdtempSync(join(tmpdir(), 'gc-empty-')); const r = gc(['start'], empty);
    expect(r.status).toBe(1); expect(r.stderr).toContain('groundcontrol init');
  });
});
