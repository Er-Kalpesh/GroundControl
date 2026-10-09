import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { checkRequest } from './security.js';
import { Orchestrator, PortInUseError, PolicyError } from '../core/orchestrator.js';
import { ConfigError } from '../config/load.js';
import { isPortFree, portOwner, killPortOwner } from '../core/ports.js';
import type { AuditLog } from '../core/audit.js';
import type { Actor } from '../types.js';

export interface Deps { orch: Orchestrator; audit: AuditLog; token: string; port: number; dashboardDir?: string }
declare module 'fastify' { interface FastifyRequest { actor: Actor } }
const actorOf = (req: FastifyRequest) => req.actor;
const sse = (reply: FastifyReply) => {
  reply.hijack();
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  return reply.raw;
};

export function buildServer(d: Deps) {
  const app = Fastify({ logger: false });
  app.decorateRequest('actor', undefined as unknown as Actor);
  const hosts = [`127.0.0.1:${d.port}`, `localhost:${d.port}`];

  app.addHook('onRequest', async (req, reply) => {
    if (!hosts.includes(req.headers.host ?? '')) return reply.code(403).send({ error: 'bad Host header' });
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/')) return;                              // static + healthz: public, but Host-checked
    const r = checkRequest({ headers: req.headers as Record<string, string | undefined> }, d.token, d.port);
    if (!r.ok) return reply.code(r.status).send({ error: r.reason });
    if (path === '/api/session' && !req.headers.authorization) return reply.code(401).send({ error: 'bearer required' });
    if (!['GET', 'HEAD'].includes(req.method) && !req.headers['x-gc-actor'])
      return reply.code(403).send({ error: 'x-gc-actor header required on mutating requests' });
    req.actor = r.actor;
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof PortInUseError) return reply.code(409).send({ error: err.message, port: err.port, owner: err.owner });
    if (err instanceof PolicyError) return reply.code(403).send({ error: err.message });
    if (err instanceof ConfigError) return reply.code(400).send({ error: err.message });
    if (/^unknown (service|project|task)/.test(err.message)) return reply.code(404).send({ error: err.message });
    if (/exactly one of/.test(err.message)) return reply.code(400).send({ error: err.message });
    reply.code(err.statusCode ?? 500).send({ error: err.message });
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.post('/api/session', async (_req, reply) => {
    reply.header('set-cookie', `gc_token=${d.token}; HttpOnly; SameSite=Strict; Path=/`).code(204).send();
  });

  app.get('/api/projects', async () => ({ projects: d.orch.listProjects() }));
  app.post<{ Body: { configFile: string } }>('/api/projects', async req => {
    if (!req.body?.configFile) throw new ConfigError('configFile is required');
    const p = d.orch.registerProject(req.body.configFile);
    return { project: p.project, services: Object.keys(p.services), tasks: Object.keys(p.tasks) };
  });

  app.get<{ Querystring: { project?: string } }>('/api/services', async req => ({ services: await d.orch.statuses(req.query.project) }));
  type SvcParams = { Params: { project: string; name: string } };
  app.post<SvcParams & { Body: { killZombies?: boolean } | undefined }>('/api/services/:project/:name/start', async req => ({
    service: await d.orch.startService(`${req.params.project}/${req.params.name}`, actorOf(req), { killZombies: !!req.body?.killZombies }) }));
  app.post<SvcParams>('/api/services/:project/:name/stop', async req => {
    await d.orch.stopService(`${req.params.project}/${req.params.name}`, actorOf(req)); return { ok: true };
  });
  app.post<SvcParams & { Body: { killZombies?: boolean } | undefined }>('/api/services/:project/:name/restart', async req => ({
    service: await d.orch.restartService(`${req.params.project}/${req.params.name}`, actorOf(req), { killZombies: !!req.body?.killZombies }) }));
  app.post<{ Params: { project: string }; Body: { only?: string[]; killZombies?: boolean } | undefined }>('/api/projects/:project/up', async req => ({
    services: await d.orch.up(req.params.project, actorOf(req), req.body?.only, { killZombies: !!req.body?.killZombies }) }));
  app.post<{ Params: { project: string } }>('/api/projects/:project/down', async req => {
    await d.orch.down(req.params.project, actorOf(req)); return { ok: true };
  });

  app.get<SvcParams & { Querystring: { tail?: string; since?: string } }>('/api/services/:project/:name/logs', async (req, reply) => {
    const id = `${req.params.project}/${req.params.name}`;
    const log = d.orch.logs(id);
    if (!log) return reply.code(404).send({ error: `unknown service ${id} or no logs yet` });
    if (req.query.since !== undefined) return log.since(Math.max(0, Number(req.query.since) || 0));
    const tail = Math.min(2000, Math.max(1, Number(req.query.tail ?? 200) || 200));
    return { lines: log.tail(tail), offset: log.size() };
  });
  app.get<SvcParams>('/api/services/:project/:name/logs/stream', (req, reply) => {
    const log = d.orch.logs(`${req.params.project}/${req.params.name}`);
    if (!log) return reply.code(404).send({ error: 'no logs' });
    const out = sse(reply);
    for (const line of log.tail(200)) out.write(`data: ${JSON.stringify({ line })}\n\n`);
    const unsub = log.subscribe((line: string) => out.write(`data: ${JSON.stringify({ line })}\n\n`));
    const hb = setInterval(() => out.write(': ping\n\n'), 15000);
    req.raw.on('close', () => { unsub(); clearInterval(hb); });
  });
  app.get('/api/events', (req, reply) => {
    const out = sse(reply);
    out.write('event: hello\ndata: {}\n\n');
    const on = (s: unknown) => out.write(`data: ${JSON.stringify(s)}\n\n`);
    d.orch.on('state', on);
    const hb = setInterval(() => out.write(': ping\n\n'), 15000);
    req.raw.on('close', () => { d.orch.off('state', on); clearInterval(hb); });
  });

  app.post<{ Body: { project?: string; task?: string; command?: string } }>('/api/tasks/run', async req => {
    const { project, task, command } = req.body ?? ({} as { project?: string; task?: string; command?: string });
    if (!project) throw new Error('exactly one of task/command is required, and project is required');
    return { result: await d.orch.runTask(project, { task, command }, actorOf(req)) };
  });

  const portOf = (raw: string) => { const n = Number(raw); return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null; };
  app.get<{ Params: { port: string } }>('/api/ports/:port', async (req, reply) => {
    const p = portOf(req.params.port); if (!p) return reply.code(400).send({ error: 'invalid port' });
    return { free: await isPortFree(p), owner: await portOwner(p) };
  });
  app.post<{ Params: { port: string } }>('/api/ports/:port/kill', async (req, reply) => {
    const p = portOf(req.params.port); if (!p) return reply.code(400).send({ error: 'invalid port' });
    if (actorOf(req).kind !== 'human') return reply.code(403).send({ error: 'only humans may kill arbitrary processes' });
    d.audit.record(actorOf(req), 'port-kill', String(p));
    return { killed: await killPortOwner(p) };
  });

  app.get<{ Querystring: { n?: string } }>('/api/audit', async req => ({ entries: d.audit.recent(Math.min(500, Number(req.query.n ?? 100) || 100)) }));

  if (d.dashboardDir && existsSync(d.dashboardDir)) app.register(fastifyStatic, { root: d.dashboardDir, prefix: '/' });
  return app;
}
