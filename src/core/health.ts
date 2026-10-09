import net from 'node:net';
import type { LogStore } from './log-store.js';
import type { ServiceConfig } from '../config/load.js';

export type HealthConfig = NonNullable<ServiceConfig['health']>;
export interface ReadyResult { ok: boolean; reason?: string }
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function probeHttp(url: string, status: number): Promise<boolean> {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).status === status; } catch { return false; }
}
export const probeTcp = (host: string, port: number) => new Promise<boolean>(resolve => {
  const s = net.connect({ host, port });
  s.setTimeout(1500);
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
  s.once('timeout', () => { s.destroy(); resolve(false); });
});

/** Resolve when the service is ready, the timeout passes, or the process dies. No health config = ready now. */
export async function waitUntilReady(
  h: HealthConfig | undefined, ctx: { log: LogStore; isAlive: () => boolean },
): Promise<ReadyResult> {
  if (!h) return { ok: true };
  const deadline = Date.now() + h.timeoutMs;

  if (h.type === 'log') {
    const re = new RegExp(h.pattern);
    if (ctx.log.tail(1000).some(l => re.test(l))) return { ok: true };
    return new Promise<ReadyResult>(resolve => {
      const unsub = ctx.log.subscribe(l => { if (re.test(l)) done({ ok: true }); });
      const timer = setInterval(() => {
        if (!ctx.isAlive()) done({ ok: false, reason: 'process exited' });
        else if (Date.now() > deadline) done({ ok: false, reason: `timeout waiting for /${h.pattern}/ in logs` });
      }, 100);
      function done(r: ReadyResult) { unsub(); clearInterval(timer); resolve(r); }
    });
  }

  for (;;) {
    if (!ctx.isAlive()) return { ok: false, reason: 'process exited' };
    const ok = h.type === 'http' ? await probeHttp(h.url, h.expectStatus) : await probeTcp(h.host, h.port);
    if (ok) return { ok: true };
    if (Date.now() > deadline) return { ok: false, reason: `health check timed out after ${h.timeoutMs}ms` };
    await sleep(h.intervalMs);
  }
}
