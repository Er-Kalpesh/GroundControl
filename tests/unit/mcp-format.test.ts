import { describe, it, expect } from 'vitest';
import { capText, resolveId, formatTask, formatLogs } from '../../src/mcp/format.js';

describe('capText', () => {
  it('passes short text through', () => expect(capText('abc', 10)).toBe('abc'));
  it('keeps the END and reports the cut', () => {
    const r = capText('0123456789', 4);
    expect(r).toContain('truncated 6 chars'); expect(r.endsWith('6789')).toBe(true);
  });
});
describe('resolveId', () => {
  it('accepts a full id, a bare name with default project, or project+name', () => {
    expect(resolveId({ id: 'p/a' })).toBe('p/a');
    expect(resolveId({ id: 'a' }, 'p')).toBe('p/a');
    expect(resolveId({ project: 'p', name: 'a' })).toBe('p/a');
    expect(resolveId({ name: 'a' }, 'p')).toBe('p/a');
  });
  it('rejects ambiguous input with a helpful message', () => {
    expect(() => resolveId({ id: 'a' })).toThrow(/project\/service/);
    expect(() => resolveId({})).toThrow(/provide id/);
  });
});
describe('formatters', () => {
  it('formatTask shows exit, duration, streams and flags', () => {
    const t = formatTask({ exitCode: 2, signal: null, stdout: 'out', stderr: 'err', truncated: true, timedOut: true, durationMs: 12 });
    expect(t).toContain('exit=2'); expect(t).toContain('TIMED OUT'); expect(t).toContain('--- stdout ---\nout'); expect(t).toContain('truncated');
  });
  it('formatLogs tells the AI how to continue', () => {
    expect(formatLogs(['a', 'b'], 42)).toBe('a\nb\n[nextOffset=42 — pass since=42 to read only newer output]');
  });
});
