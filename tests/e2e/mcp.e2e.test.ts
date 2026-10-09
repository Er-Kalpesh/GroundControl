import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isAlive } from '../../src/core/state-file.js';
import { getFreePort, waitFor } from '../helpers.js';

let home: string, port: number, projDir: string, env: Record<string, string>;
let client: Client | undefined;
const text = (r: any) => (r.content as { text: string }[]).map(c => c.text).join('\n');

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'gc-mcp-')); port = await getFreePort(); projDir = mkdtempSync(join(tmpdir(), 'gc-mcpproj-'));
  const web = await getFreePort();
  writeFileSync(join(projDir, 'groundcontrol.json'), JSON.stringify({ version: 1, project: 'demo',
    services: { web: { command: `node ${resolve('tests/fixtures/echo-server.mjs')}`, port: web, health: { type: 'tcp', port: web, intervalMs: 50 } } },
    tasks: { hello: { command: 'echo hi' } } }));
  env = { ...process.env as Record<string, string>, GROUNDCONTROL_HOME: home, GROUNDCONTROL_PORT: String(port), GROUNDCONTROL_SKIP_SHELL_PATH: '1' };
});
afterAll(async () => {
  try { await client?.close(); } catch { /* already closed */ }
  try { process.kill(Number(readFileSync(join(home, 'daemon.pid'), 'utf8')), 'SIGTERM'); } catch { /* none */ }
  rmSync(home, { recursive: true, force: true });
});

describe('MCP bridge e2e', () => {
  it('lists the tools', async () => {
    client = new Client({ name: 'mcp-e2e', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli/index.js'), 'mcp-server'], env, cwd: projDir }));
    const names = (await client.listTools()).tools.map(t => t.name).sort();
    expect(names).toEqual(['groundcontrol_get_logs', 'groundcontrol_get_status', 'groundcontrol_list_tasks', 'groundcontrol_restart_service',
      'groundcontrol_run_task', 'groundcontrol_start_service', 'groundcontrol_stop_service']);
    const status = (await client.listTools()).tools.find(t => t.name === 'groundcontrol_get_status')!;
    expect(status.annotations?.readOnlyHint).toBe(true);
  });
  it('get_status auto-registers the project from the working directory', async () => {
    const r = await client!.callTool({ name: 'groundcontrol_get_status', arguments: {} });
    expect(text(r)).toContain('demo/web'); expect(text(r)).toContain('stopped');
  });
  it('list_tasks and run_task (declared task allowed, arbitrary command refused)', async () => {
    expect(text(await client!.callTool({ name: 'groundcontrol_list_tasks', arguments: {} }))).toContain('hello');
    const ok = await client!.callTool({ name: 'groundcontrol_run_task', arguments: { task: 'hello' } });
    expect(ok.isError).toBeFalsy(); expect(text(ok)).toContain('hi');
    const no = await client!.callTool({ name: 'groundcontrol_run_task', arguments: { command: 'echo pwned' } });
    expect(no.isError).toBe(true); expect(text(no)).toMatch(/groundcontrol\.json/);
  });
  it('start_service is non-blocking, then status becomes ready; logs are incremental', async () => {
    const r = await client!.callTool({ name: 'groundcontrol_start_service', arguments: { id: 'web' } });
    expect(r.isError).toBeFalsy(); expect(text(r)).toContain('demo/web started');
    await waitFor(async () => text(await client!.callTool({ name: 'groundcontrol_get_status', arguments: {} })).includes('ready'), 10000, 100);
    await waitFor(async () => text(await client!.callTool({ name: 'groundcontrol_get_logs', arguments: { id: 'web' } })).includes('tick'), 10000, 100);
    const first = text(await client!.callTool({ name: 'groundcontrol_get_logs', arguments: { id: 'web', lines: 50 } }));
    const off = Number(first.match(/nextOffset=(\d+)/)![1]);
    await new Promise(r => setTimeout(r, 600));
    const next = text(await client!.callTool({ name: 'groundcontrol_get_logs', arguments: { id: 'web', since: off } }));
    expect(next).toContain('tick'); expect(next).not.toContain('listening');
  });
  it('audit log attributes actions to the MCP client name', async () => {
    const { ensureDaemon } = await import('../../src/client/ensure-daemon.js');
    Object.assign(process.env, { GROUNDCONTROL_HOME: home, GROUNDCONTROL_PORT: String(port) });
    const c = await ensureDaemon({ port });
    const e = await c.audit(50);
    expect(e.some(x => x.action === 'start' && x.actor.kind === 'ai' && x.actor.name === 'mcp-e2e')).toBe(true);
  });
  it('HEADLINE: the service keeps running after the MCP process is gone', async () => {
    const { ensureDaemon } = await import('../../src/client/ensure-daemon.js');
    const c = await ensureDaemon({ port });
    const pid = (await c.services('demo'))[0]!.pid!;
    await client!.close(); client = undefined;                         // kills the MCP stdio process
    await new Promise(r => setTimeout(r, 500));
    expect(isAlive(pid)).toBe(true);
    expect((await c.services('demo'))[0]!.state).toBe('ready');
    await c.down('demo');
    expect(isAlive(pid)).toBe(false);
  });
});
