import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { buildServer } from '../../src/daemon/server.js';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { ProcessManager } from '../../src/core/process-manager.js';
import { StateFile } from '../../src/core/state-file.js';
import { AuditLog } from '../../src/core/audit.js';
import { getFreePort, waitFor } from '../helpers.js';

const TOKEN = 't'.repeat(64), PORT = 19876;
const H = (extra: Record<string, string> = {}) =>
  ({ host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}`, 'x-gc-actor': 'human:test', ...extra });
let dir: string, pm: ProcessManager, orch: Orchestrator, app: ReturnType<typeof buildServer>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gc-srv-'));
  pm = new ProcessManager({ stateFile: new StateFile(join(dir, 's.json')), logsDir: join(dir, 'logs') });
  const audit = new AuditLog(join(dir, 'a.log'));
  orch = new Orchestrator({ pm, audit });
  const cfgFile = join(dir, 'groundcontrol.json');
  writeFileSync(cfgFile, JSON.stringify({ version: 1, project: 'p',
    services: { web: { command: `node ${resolve('tests/fixtures/echo-server.mjs')}` } },
    tasks: { hello: { command: 'echo hi' } } }));
  orch.registerProject(cfgFile);
  app = buildServer({ orch, audit, token: TOKEN, port: PORT });
  await app.ready();
});
afterEach(async () => { orch.dispose(); await app.close(); await pm.shutdown({ killChildren: true }); rmSync(dir, { recursive: true, force: true }); });

describe('auth', () => {
  it('rejects missing token with 401', async () =>
    expect((await app.inject({ url: '/api/services', headers: { host: `127.0.0.1:${PORT}` } })).statusCode).toBe(401));
  it('rejects wrong token with 401', async () =>
    expect((await app.inject({ url: '/api/services', headers: H({ authorization: 'Bearer nope' }) })).statusCode).toBe(401));
  it('rejects a foreign Host with 403 (DNS rebinding)', async () =>
    expect((await app.inject({ url: '/api/services', headers: H({ host: 'evil.com' }) })).statusCode).toBe(403));
  it('rejects a foreign Origin with 403 (CSRF)', async () =>
    expect((await app.inject({ url: '/api/services', headers: H({ origin: 'https://evil.com' }) })).statusCode).toBe(403));
  it('requires x-gc-actor on POST', async () => {
    const h = H(); delete (h as any)['x-gc-actor'];
    expect((await app.inject({ method: 'POST', url: '/api/services/p/web/stop', headers: h })).statusCode).toBe(403);
  });
  it('healthz needs no token but still checks Host', async () => {
    expect((await app.inject({ url: '/healthz', headers: { host: `127.0.0.1:${PORT}` } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/healthz', headers: { host: 'evil.com' } })).statusCode).toBe(403);
  });
  it('POST /api/session sets an HttpOnly SameSite=Strict cookie', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/session', headers: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}`, 'x-gc-actor': 'human:dashboard' } });
    expect(r.statusCode).toBe(204);
    const c = String(r.headers['set-cookie']); expect(c).toContain('HttpOnly'); expect(c).toContain('SameSite=Strict');
  });
});

describe('services', () => {
  it('lists configured services as stopped', async () => {
    const r = await app.inject({ url: '/api/services', headers: H() });
    expect(r.json().services.map((s: any) => [s.id, s.state])).toEqual([['p/web', 'stopped']]);
  });
  it('start -> logs -> stop', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/services/p/web/start', headers: H(), payload: {} })).statusCode).toBe(200);
    await waitFor(() => (orch.logs('p/web')?.tail(10) ?? []).join('\n').includes('tick'));
    const logs = (await app.inject({ url: '/api/services/p/web/logs?tail=10', headers: H() })).json();
    expect(logs.lines.join('\n')).toContain('tick'); expect(typeof logs.offset).toBe('number');
    expect((await app.inject({ method: 'POST', url: '/api/services/p/web/stop', headers: H() })).statusCode).toBe(200);
  });
  it('caps tail at 2000', async () => {
    await app.inject({ method: 'POST', url: '/api/services/p/web/start', headers: H(), payload: {} });
    const r = await app.inject({ url: '/api/services/p/web/logs?tail=999999', headers: H() });
    expect(r.statusCode).toBe(200); expect(r.json().lines.length).toBeLessThanOrEqual(2000);
  });
  it('returns 404 for unknown service', async () =>
    expect((await app.inject({ method: 'POST', url: '/api/services/p/zzz/start', headers: H(), payload: {} })).statusCode).toBe(404));
  it('returns 409 with owner info when the port is taken', async () => {
    const port = await getFreePort(); const blocker = net.createServer().listen(port, '127.0.0.1');
    await new Promise(r => blocker.once('listening', r));
    const f = join(dir, 'c2.json'); writeFileSync(f, JSON.stringify({ version: 1, project: 'q', services: { s: { command: 'x', port } } }));
    orch.registerProject(f);
    const r = await app.inject({ method: 'POST', url: '/api/services/q/s/start', headers: H(), payload: {} });
    expect(r.statusCode).toBe(409); expect(r.json().port).toBe(port); blocker.close();
  });
});

describe('tasks and ports', () => {
  it('AI may run a declared task but not an arbitrary command', async () => {
    const ok = await app.inject({ method: 'POST', url: '/api/tasks/run', headers: H({ 'x-gc-actor': 'ai:claude' }), payload: { project: 'p', task: 'hello' } });
    expect(ok.statusCode).toBe(200); expect(ok.json().result.stdout.trim()).toBe('hi');
    const no = await app.inject({ method: 'POST', url: '/api/tasks/run', headers: H({ 'x-gc-actor': 'ai:claude' }), payload: { project: 'p', command: 'echo pwned' } });
    expect(no.statusCode).toBe(403);
  });
  it('humans may run arbitrary commands', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/tasks/run', headers: H(), payload: { project: 'p', command: 'echo ok' } });
    expect(r.json().result.stdout.trim()).toBe('ok');
  });
  it('ai cannot kill a port owner', async () =>
    expect((await app.inject({ method: 'POST', url: '/api/ports/1/kill', headers: H({ 'x-gc-actor': 'ai:claude' }) })).statusCode).toBe(403));
  it('rejects invalid port numbers', async () =>
    expect((await app.inject({ url: '/api/ports/abc', headers: H() })).statusCode).toBe(400));
  it('audit trail records who did what', async () => {
    await app.inject({ method: 'POST', url: '/api/tasks/run', headers: H({ 'x-gc-actor': 'ai:claude' }), payload: { project: 'p', task: 'hello' } });
    const e = (await app.inject({ url: '/api/audit?n=5', headers: H() })).json().entries;
    expect(e.at(-1)).toMatchObject({ action: 'task', actor: { kind: 'ai', name: 'claude' } });
  });
});
