import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureDaemon } from '../client/ensure-daemon.js';
import { GcError, type GcClient } from '../client/http-client.js';
import { findConfig } from '../config/load.js';
import { capText, resolveId, formatStatus, formatTask, formatLogs } from './format.js';

const INSTRUCTIONS =
  'GroundControl runs the developer\'s servers in a background daemon. Services keep running after this session ends. '
  + 'Call groundcontrol_get_status before starting anything. Starting is non-blocking: poll get_status until state is "ready". '
  + 'When reading logs, pass "since" with the previous nextOffset so you never re-read old output. '
  + 'You may run only tasks listed by groundcontrol_list_tasks.';

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (text: string): Result => ({ content: [{ type: 'text', text: capText(text) }] });
const fail = (text: string): Result => ({ content: [{ type: 'text', text: capText(text) }], isError: true });

function explain(e: unknown): Result {
  if (e instanceof GcError) {
    if (e.status === 409 && e.body?.port) {
      const o = e.body.owner;
      return fail(`Port ${e.body.port} is in use${o ? ` by ${o.command} (pid ${o.pid})` : ''}. `
        + 'If that is a stale process you may retry with killZombies=true; otherwise tell the user.');
    }
    if (e.status === 403) return fail(`Not allowed: ${e.message}`);
    return fail(`GroundControl error (${e.status}): ${e.message}`);
  }
  return fail(String((e as Error).message ?? e));
}

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({ name: 'groundcontrol', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  const actorName = () => (server.server.getClientVersion()?.name ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '-');
  const client = (): Promise<GcClient> => ensureDaemon({ actor: `ai:${actorName()}` });

  /** explicit project > project of the groundcontrol.json above the cwd > the only registered project. */
  async function defaultProject(c: GcClient, explicit?: string): Promise<string | undefined> {
    if (explicit) return explicit;
    const cfg = findConfig(process.cwd());
    if (cfg) return (await c.registerProject(cfg)).project as string;
    const all = await c.projects();
    return all.length === 1 ? all[0].project : undefined;
  }
  const guard = <A>(fn: (a: A, c: GcClient) => Promise<Result>) => async (a: A): Promise<Result> => {
    try { return await fn(a, await client()); } catch (e) { return explain(e); }
  };

  server.registerTool('groundcontrol_get_status', {
    title: 'Get service status',
    description: 'List every configured service with state (stopped|starting|running|ready|unhealthy|crashed), pid, port, cpu, memory, uptime.',
    inputSchema: { project: z.string().optional().describe('project name; defaults to the project of the current directory') },
    annotations: { readOnlyHint: true },
  }, guard(async ({ project }, c) => ok(formatStatus(await c.services(await defaultProject(c, project))))));

  server.registerTool('groundcontrol_get_logs', {
    title: 'Get service logs',
    description: 'Recent output of a service. Returns nextOffset; pass it as "since" next time to read only new lines.',
    inputSchema: {
      id: z.string().describe('"project/service" or just "service" for the current project'),
      lines: z.number().int().min(1).max(500).default(100),
      since: z.number().int().min(0).optional().describe('byte offset from a previous call'),
    },
    annotations: { readOnlyHint: true },
  }, guard(async (a, c) => {
    const id = resolveId({ id: a.id }, await defaultProject(c));
    const r = await c.logs(id, a.since !== undefined ? { since: a.since } : { tail: a.lines });
    return ok(formatLogs(r.lines, r.offset));
  }));

  server.registerTool('groundcontrol_start_service', {
    title: 'Start a service',
    description: 'Start one service (its dependencies are NOT started; use project-level start via CLI for that). Non-blocking: returns after spawn; poll get_status for "ready".',
    inputSchema: {
      id: z.string().optional(), project: z.string().optional(), name: z.string().optional(),
      killZombies: z.boolean().default(false).describe('kill a stale process that occupies the service port'),
    },
  }, guard(async (a, c) => {
    const s = await c.start(resolveId(a, await defaultProject(c, a.project)), { killZombies: a.killZombies });
    return ok(`${s.id} started (pid ${s.pid}). It is "${s.state}"; poll groundcontrol_get_status until it is "ready".`);
  }));

  server.registerTool('groundcontrol_stop_service', {
    title: 'Stop a service',
    description: 'Gracefully stop a service and all its child processes.',
    inputSchema: { id: z.string().optional(), project: z.string().optional(), name: z.string().optional() },
    annotations: { destructiveHint: true },
  }, guard(async (a, c) => {
    const id = resolveId(a, await defaultProject(c, a.project));
    await c.stop(id);
    return ok(`${id} stopped.`);
  }));

  server.registerTool('groundcontrol_restart_service', {
    title: 'Restart a service',
    description: 'Stop then start a service.',
    inputSchema: { id: z.string().optional(), project: z.string().optional(), name: z.string().optional(), killZombies: z.boolean().default(false) },
  }, guard(async (a, c) => {
    const s = await c.restart(resolveId(a, await defaultProject(c, a.project)), { killZombies: a.killZombies });
    return ok(`${s.id} restarted (pid ${s.pid}); state "${s.state}".`);
  }));

  server.registerTool('groundcontrol_list_tasks', {
    title: 'List runnable tasks',
    description: 'Tasks declared in groundcontrol.json that groundcontrol_run_task may run.',
    inputSchema: { project: z.string().optional() },
    annotations: { readOnlyHint: true },
  }, guard(async ({ project }, c) => {
    const p = await defaultProject(c, project);
    const list = (await c.projects()).filter(x => !p || x.project === p);
    return ok(list.map(x => `${x.project}: ${x.tasks.join(', ') || '(no tasks declared)'}`).join('\n') || 'no projects registered');
  }));

  server.registerTool('groundcontrol_run_task', {
    title: 'Run a task',
    description: 'Run a declared task (blocking) and return exit code, stdout and stderr. Arbitrary "command" is refused unless the project policy allows it.',
    inputSchema: { project: z.string().optional(), task: z.string().optional(), command: z.string().optional() },
  }, guard(async (a, c) => {
    if (!!a.task === !!a.command) return fail('provide exactly one of "task" or "command"');
    const p = await defaultProject(c, a.project);
    if (!p) return fail('could not determine the project; pass "project"');
    const r = await c.runTask(p, a.task ? { task: a.task } : { command: a.command });
    return r.exitCode === 0 ? ok(formatTask(r)) : fail(formatTask(r));
  }));

  server.registerResource('status', 'groundcontrol://status', { title: 'Service status', mimeType: 'text/plain' },
    async uri => ({ contents: [{ uri: uri.href, text: formatStatus(await (await client()).services()) }] }));
  server.registerResource('logs', new ResourceTemplate('groundcontrol://logs/{project}/{name}', { list: undefined }),
    { title: 'Service logs (last 200 lines)', mimeType: 'text/plain' },
    async (uri, v) => {
      const r = await (await client()).logs(`${v.project}/${v.name}`, { tail: 200 });
      return { contents: [{ uri: uri.href, text: capText(r.lines.join('\n')) }] };
    });

  await server.connect(new StdioServerTransport());
}
