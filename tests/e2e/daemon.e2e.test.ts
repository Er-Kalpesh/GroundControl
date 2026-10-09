import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isAlive } from '../../src/core/state-file.js';
import { readToken } from '../../src/client/ensure-daemon.js';
import { getFreePort, waitFor } from '../helpers.js';

const echo = resolve('tests/fixtures/echo-server.mjs');
let home: string, port: number, projDir: string, cfgFile: string;
let ensureDaemon: typeof import('../../src/client/ensure-daemon.js').ensureDaemon;
const pidOf = () => Number(readFileSync(join(home, 'daemon.pid'), 'utf8'));

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'gc-e2e-'));
  port = await getFreePort();
  Object.assign(process.env, {
    GROUNDCONTROL_HOME: home, GROUNDCONTROL_PORT: String(port),
    GROUNDCONTROL_DAEMON_ENTRY: resolve('dist/daemon/main.js'), GROUNDCONTROL_SKIP_SHELL_PATH: '1',
  });
  projDir = mkdtempSync(join(tmpdir(), 'gc-proj-'));
  const [a, b] = [await getFreePort(), await getFreePort()];
  cfgFile = join(projDir, 'groundcontrol.json');
  writeFileSync(cfgFile, JSON.stringify({ version: 1, project: 'demo', services: {
    one: { command: `node ${echo}`, port: a, health: { type: 'tcp', port: a, intervalMs: 50 } },
    two: { command: `node ${echo}`, port: b, dependsOn: ['one'], health: { type: 'http', url: `http://127.0.0.1:${b}/`, intervalMs: 50 } },
  } }));
  ({ ensureDaemon } = await import('../../src/client/ensure-daemon.js'));
});

afterAll(async () => {
  try { const c = await ensureDaemon({ port }); await c.down('demo').catch(() => {}); } catch { /* daemon already gone */ }
  try { process.kill(pidOf(), 'SIGTERM'); } catch { /* not running */ }
  rmSync(home, { recursive: true, force: true });
});

describe('daemon e2e', () => {
  it('auto-starts once and is reused', async () => {
    const c1 = await ensureDaemon({ port }); const pid1 = pidOf();
    await ensureDaemon({ port });
    expect(pidOf()).toBe(pid1);
    expect(await c1.health()).toBe(true);
  });
  it('rejects unauthenticated API calls and foreign Host headers', async () => {
    expect((await fetch(`http://127.0.0.1:${port}/api/services`)).status).toBe(401);
    const { request } = await import('node:http');
    const status = await new Promise<number>(res => {
      const r = request({ host: '127.0.0.1', port, path: '/healthz', headers: { host: 'evil.com' } }, x => res(x.statusCode!));
      r.end();
    });
    expect(status).toBe(403);
  });
  it('brings the project up in dependency order', async () => {
    const c = await ensureDaemon({ port });
    await c.registerProject(cfgFile);
    const s = await c.up('demo');
    expect(s.map(x => [x.name, x.state])).toEqual([['one', 'ready'], ['two', 'ready']]);
  });
  it('HEADLINE: services survive the daemon being killed, and a new daemon adopts them', async () => {
    const c = await ensureDaemon({ port });
    const before = (await c.services('demo')).map(s => s.pid!);
    const oldDaemon = pidOf();
    process.kill(oldDaemon, 'SIGTERM');
    await waitFor(() => !isAlive(oldDaemon), 8000);
    for (const pid of before) expect(isAlive(pid)).toBe(true);                     // children are still running
    const c2 = await ensureDaemon({ port });                                        // a fresh daemon starts…
    const after = await c2.services('demo');
    expect(after.map(s => s.pid)).toEqual(before);                                  // …and adopts the same pids
    expect(after.every(s => ['running', 'ready'].includes(s.state))).toBe(true);
    expect((await fetch(`http://127.0.0.1:${after[0]!.port}/`)).status).toBe(200);   // service still answers
  });
  it('streams logs over SSE', async () => {
    const c = await ensureDaemon({ port });
    const got: string[] = []; const ac = new AbortController();
    const p = c.streamLogs('demo/one', l => got.push(l), ac.signal).catch(() => {});
    await waitFor(() => got.length > 0, 5000); ac.abort(); await p;
    expect(got.join('\n')).toContain('tick');
  });
  it('streams state events over SSE', async () => {
    await ensureDaemon({ port });
    const r = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { authorization: `Bearer ${readToken()}`, 'x-gc-actor': 'human:test' } });
    expect(r.status).toBe(200); expect(r.headers.get('content-type')).toContain('text/event-stream');
    const reader = r.body!.getReader(); const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('event: hello'); await reader.cancel();
  });
  it('records the actor in the audit log', async () => {
    const c = (await ensureDaemon({ port })).withActor('ai:test-ai');
    await c.runTask('demo', { command: 'echo x' }).catch(() => {});
    const entries = await c.audit(20);
    expect(entries.some(e => e.action === 'task-denied' && e.actor.name === 'test-ai')).toBe(true);
  });
  it('down stops everything', async () => {
    const c = await ensureDaemon({ port });
    const pids = (await c.services('demo')).map(s => s.pid!).filter(Boolean);
    await c.down('demo');
    for (const pid of pids) expect(isAlive(pid)).toBe(false);
  });
});
