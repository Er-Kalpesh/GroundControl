import type { ServiceStatus } from '../types.js';

export class GcError extends Error {
  constructor(public status: number, public body: any) { super(body?.error ?? `HTTP ${status}`); }
}
export class GcClient {
  constructor(private o: { port: number; token: string; actor: string }) {}
  withActor(actor: string) { return new GcClient({ ...this.o, actor }); }
  private url(p: string) { return `http://127.0.0.1:${this.o.port}${p}`; }
  private headers(json = false): Record<string, string> {
    return { authorization: `Bearer ${this.o.token}`, 'x-gc-actor': this.o.actor, ...(json ? { 'content-type': 'application/json' } : {}) };
  }
  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(this.url(path), { method, headers: this.headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); const json = text ? JSON.parse(text) : {};
    if (!r.ok) throw new GcError(r.status, json);
    return json as T;
  }
  async health() { try { return (await fetch(this.url('/healthz'), { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }
  projects() { return this.req<{ projects: any[] }>('GET', '/api/projects').then(r => r.projects); }
  registerProject(configFile: string) { return this.req<any>('POST', '/api/projects', { configFile }); }
  services(project?: string) { return this.req<{ services: ServiceStatus[] }>('GET', '/api/services' + (project ? `?project=${encodeURIComponent(project)}` : '')).then(r => r.services); }
  start(id: string, o: { killZombies?: boolean } = {}) { return this.req<{ service: ServiceStatus }>('POST', `/api/services/${id}/start`, o).then(r => r.service); }
  stop(id: string) { return this.req<unknown>('POST', `/api/services/${id}/stop`, {}).then(() => {}); }
  restart(id: string, o: { killZombies?: boolean } = {}) { return this.req<{ service: ServiceStatus }>('POST', `/api/services/${id}/restart`, o).then(r => r.service); }
  up(project: string, only?: string[], o: { killZombies?: boolean } = {}) { return this.req<{ services: ServiceStatus[] }>('POST', `/api/projects/${project}/up`, { only, ...o }).then(r => r.services); }
  down(project: string) { return this.req<unknown>('POST', `/api/projects/${project}/down`, {}).then(() => {}); }
  logs(id: string, q: { tail?: number; since?: number } = {}) {
    const qs = q.since !== undefined ? `since=${q.since}` : `tail=${q.tail ?? 200}`;
    return this.req<{ lines: string[]; offset: number }>('GET', `/api/services/${id}/logs?${qs}`);
  }
  async streamLogs(id: string, onLine: (l: string) => void, signal: AbortSignal) {
    const r = await fetch(this.url(`/api/services/${id}/logs/stream`), { headers: this.headers(), signal });
    if (!r.ok || !r.body) throw new GcError(r.status, await r.json().catch(() => ({})));
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of r.body as any) {
      buf += dec.decode(chunk, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = frame.split('\n').find(l => l.startsWith('data: '));
        if (data) { try { onLine(JSON.parse(data.slice(6)).line); } catch {} }
      }
    }
  }
  runTask(project: string, arg: { task?: string; command?: string }) { return this.req<{ result: any }>('POST', '/api/tasks/run', { project, ...arg }).then(r => r.result); }
  port(n: number) { return this.req<{ free: boolean; owner: any }>('GET', `/api/ports/${n}`); }
  killPort(n: number) { return this.req<{ killed: boolean }>('POST', `/api/ports/${n}/kill`, {}).then(r => r.killed); }
  audit(n = 100) { return this.req<{ entries: any[] }>('GET', `/api/audit?n=${n}`).then(r => r.entries); }
}
