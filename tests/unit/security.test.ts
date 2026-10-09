import { describe, it, expect } from 'vitest';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureToken, checkRequest, canRunTask, parseActor } from '../../src/daemon/security.js';

const T = 'a'.repeat(64), P = 9876;
const h = (extra: Record<string, string> = {}) => ({ headers: { host: `127.0.0.1:${P}`, authorization: `Bearer ${T}`, ...extra } });

describe('ensureToken', () => {
  it('creates a 64-hex token with mode 0600 and reuses it', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'gc-')), 'token');
    const t = ensureToken(f);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(ensureToken(f)).toBe(t); expect(readFileSync(f, 'utf8')).toBe(t);
  });
});
describe('checkRequest', () => {
  it('accepts a good request and parses the actor', () => {
    const r = checkRequest(h({ 'x-gc-actor': 'ai:claude-desktop' }), T, P);
    expect(r).toEqual({ ok: true, actor: { kind: 'ai', name: 'claude-desktop' } });
  });
  it('accepts localhost host and cookie auth', () => {
    expect(checkRequest({ headers: { host: `localhost:${P}`, cookie: `x=1; gc_token=${T}` } }, T, P).ok).toBe(true);
  });
  it.each(['evil.com', `127.0.0.1.evil.com:${P}`, `127.0.0.1:1`, ''])('rejects Host %s with 403', host => {
    expect(checkRequest(h({ host }), T, P)).toMatchObject({ ok: false, status: 403 });
  });
  it('rejects a foreign Origin with 403 and accepts our own', () => {
    expect(checkRequest(h({ origin: 'https://evil.com' }), T, P)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest(h({ origin: `http://127.0.0.1:${P}` }), T, P).ok).toBe(true);
  });
  it('rejects a missing token, a wrong token and a wrong-length token with 401', () => {
    expect(checkRequest({ headers: { host: `127.0.0.1:${P}` } }, T, P)).toMatchObject({ ok: false, status: 401 });
    expect(checkRequest(h({ authorization: 'Bearer ' + 'b'.repeat(64) }), T, P)).toMatchObject({ ok: false, status: 401 });
    expect(checkRequest(h({ authorization: 'Bearer short' }), T, P)).toMatchObject({ ok: false, status: 401 });
  });
});
describe('parseActor', () => {
  it('handles colons in names and garbage', () => {
    expect(parseActor('ai:foo:bar')).toEqual({ kind: 'ai', name: 'foo:bar' });
    expect(parseActor('human')).toEqual({ kind: 'human', name: 'unknown' });
    expect(parseActor('root:me')).toEqual({ kind: 'human', name: 'unknown' });
    expect(parseActor(undefined)).toEqual({ kind: 'human', name: 'unknown' });
  });
});
describe('canRunTask', () => {
  const ai = { kind: 'ai', name: 'x' } as const, human = { kind: 'human', name: 'x' } as const;
  it('matrix', () => {
    expect(canRunTask(ai, { taskName: 'migrate' }, { allowArbitraryTasks: false }).allowed).toBe(true);
    expect(canRunTask(ai, { command: 'rm -rf /' }, { allowArbitraryTasks: false }).allowed).toBe(false);
    expect(canRunTask(ai, { command: 'ls' }, { allowArbitraryTasks: true }).allowed).toBe(true);
    expect(canRunTask(human, { command: 'ls' }, { allowArbitraryTasks: false }).allowed).toBe(true);
    expect(canRunTask(ai, { command: 'x' }, { allowArbitraryTasks: false }).reason).toMatch(/groundcontrol\.json/);
  });
});
