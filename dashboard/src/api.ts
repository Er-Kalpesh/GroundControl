import type { AuditEntry, ProjectInfo, Service, TaskResult } from './types';

export class ApiError extends Error {
  constructor(public status: number, public body: any) { super(body?.error ?? `HTTP ${status}`); }
}

const headers = (json: boolean): Record<string, string> =>
  ({ 'x-gc-actor': 'human:dashboard', ...(json ? { 'content-type': 'application/json' } : {}) });

async function req<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const r = await fetch(path, { method, headers: { ...headers(body !== undefined), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  const json = text ? JSON.parse(text) : {};
  if (!r.ok) throw new ApiError(r.status, json);
  return json as T;
}

export const api = {
  projects: () => req<{ projects: ProjectInfo[] }>('GET', '/api/projects').then(r => r.projects),
  services: (project?: string) => req<{ services: Service[] }>('GET', '/api/services' + (project ? `?project=${encodeURIComponent(project)}` : '')).then(r => r.services),
  start: (id: string, killZombies = false) => req<{ service: Service }>('POST', `/api/services/${id}/start`, { killZombies }),
  stop: (id: string) => req<unknown>('POST', `/api/services/${id}/stop`, {}),
  restart: (id: string, killZombies = false) => req<{ service: Service }>('POST', `/api/services/${id}/restart`, { killZombies }),
  up: (project: string) => req<unknown>('POST', `/api/projects/${project}/up`, {}),
  down: (project: string) => req<unknown>('POST', `/api/projects/${project}/down`, {}),
  runTask: (project: string, arg: { task?: string; command?: string }) => req<{ result: TaskResult }>('POST', '/api/tasks/run', { project, ...arg }).then(r => r.result),
  audit: (n = 50) => req<{ entries: AuditEntry[] }>('GET', `/api/audit?n=${n}`).then(r => r.entries),
};

/**
 * `groundcontrol ui` opens /#token=<token>. Exchange it once for an HttpOnly cookie, then strip it from the URL
 * (fragments are never sent to the server or logged). Without a fragment, rely on an existing cookie.
 */
export async function bootstrap(): Promise<'ok' | 'need-token'> {
  const m = location.hash.match(/token=([0-9a-f]+)/);
  if (m) {
    await req('POST', '/api/session', {}, { authorization: `Bearer ${m[1]}` }).catch(() => undefined);
    history.replaceState(null, '', location.pathname + location.search);
  }
  try { await api.projects(); return 'ok'; }
  catch (e) { if (e instanceof ApiError && e.status === 401) return 'need-token'; throw e; }
}
