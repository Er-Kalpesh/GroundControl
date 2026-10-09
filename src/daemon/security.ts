import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Actor } from '../types.js';

/** Create the API token (32 random bytes, hex, mode 0600) on first use; return it. */
export function ensureToken(file: string): string {
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const t = randomBytes(32).toString('hex');
  writeFileSync(file, t, { mode: 0o600 });
  return t;
}

const eq = (a: string, b: string) => {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
};

/** "ai:claude-desktop" -> {kind:'ai', name:'claude-desktop'}. Anything malformed becomes human:unknown. */
export function parseActor(h?: string): Actor {
  const i = (h ?? '').indexOf(':');
  const kind = i < 0 ? '' : h!.slice(0, i);
  const name = i < 0 ? '' : h!.slice(i + 1);
  return kind === 'ai' || kind === 'human' || kind === 'system'
    ? { kind, name: name || 'unknown' }
    : { kind: 'human', name: 'unknown' };
}

export type AuthResult = { ok: true; actor: Actor } | { ok: false; status: 401 | 403; reason: string };

/**
 * Host header must be our own loopback address (defeats DNS rebinding), Origin (if sent) must be us
 * (defeats cross-site requests), and a valid token must be presented as a Bearer header or gc_token cookie.
 */
export function checkRequest(req: { headers: Record<string, string | undefined> }, token: string, port: number): AuthResult {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(req.headers.host ?? '')) return { ok: false, status: 403, reason: 'bad Host header' };
  const origin = req.headers.origin;
  if (origin && !hosts.some(h => origin === `http://${h}`)) return { ok: false, status: 403, reason: 'bad Origin' };
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const cookie = req.headers.cookie?.match(/(?:^|;\s*)gc_token=([^;]+)/)?.[1];
  const given = bearer ?? cookie;
  if (!given || !eq(given, token)) return { ok: false, status: 401, reason: 'missing or invalid token' };
  return { ok: true, actor: parseActor(req.headers['x-gc-actor']) };
}

/** Humans may run anything. AI callers may run only declared tasks unless the project opts in. */
export function canRunTask(
  actor: Actor, arg: { taskName?: string; command?: string }, policy: { allowArbitraryTasks: boolean },
): { allowed: boolean; reason?: string } {
  if (actor.kind !== 'ai') return { allowed: true };
  if (arg.taskName) return { allowed: true };
  if (policy.allowArbitraryTasks) return { allowed: true };
  return {
    allowed: false,
    reason: 'AI callers may only run tasks declared under "tasks" in groundcontrol.json. '
      + 'Declare the task there, or set policy.allowArbitraryTasks=true to allow arbitrary commands.',
  };
}
