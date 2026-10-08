import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, startOrder, loadConfig, findConfig, ConfigError } from '../../src/config/load.js';

const base = (services: unknown) => ({ version: 1, project: 'p', services });

describe('parseConfig', () => {
  it('applies defaults', () => {
    const c = parseConfig(base({ a: { command: 'echo hi' } }), '/r/groundcontrol.json');
    const a = c.services.a!;
    expect(a.cwd).toBe('/r');
    expect(a.restart).toEqual({ policy: 'never', maxRetries: 3, backoffMs: 1000 });
    expect(a.stopTimeoutMs).toBe(10000);
    expect(a.dependsOn).toEqual([]);
    expect(a.autostart).toBe(true);
    expect(c.policy.allowArbitraryTasks).toBe(false);
    expect(c.tasks).toEqual({});
  });
  it('resolves relative cwd against the config directory', () => {
    const c = parseConfig(base({ a: { command: 'x', cwd: 'web' } }), '/r/groundcontrol.json');
    expect(c.services.a!.cwd).toBe('/r/web');
  });
  it('fills health defaults', () => {
    const c = parseConfig(base({ a: { command: 'x', health: { type: 'http', url: 'http://localhost:1/up' } } }), '/r/g.json');
    expect(c.services.a!.health).toMatchObject({ expectStatus: 200, intervalMs: 2000, timeoutMs: 60000 });
  });
  it('rejects project names containing a slash (they appear in ids)', () => {
    expect(() => parseConfig({ version: 1, project: 'a/b', services: {} }, '/r/g.json')).toThrow(/project/);
  });
  it('rejects a missing command with a readable path', () => {
    expect(() => parseConfig(base({ a: {} }), '/r/g.json')).toThrow(/services\.a\.command/);
  });
  it('rejects unknown version', () => {
    expect(() => parseConfig({ version: 2, project: 'p', services: {} }, '/r/g.json')).toThrow(ConfigError);
  });
});

describe('startOrder', () => {
  it('orders dependencies first', () => {
    const c = parseConfig(base({
      web: { command: 'x', dependsOn: ['api'] },
      api: { command: 'x', dependsOn: ['db'] },
      db: { command: 'x' },
    }), '/r/g.json');
    expect(startOrder(c)).toEqual(['db', 'api', 'web']);
  });
  it('throws on a cycle', () => {
    const c = parseConfig(base({ a: { command: 'x', dependsOn: ['b'] }, b: { command: 'x', dependsOn: ['a'] } }), '/r/g.json');
    expect(() => startOrder(c)).toThrow(/cycle/i);
  });
  it('throws on an unknown dependency', () => {
    const c = parseConfig(base({ a: { command: 'x', dependsOn: ['zzz'] } }), '/r/g.json');
    expect(() => startOrder(c)).toThrow(/unknown.*zzz/i);
  });
});

describe('loadConfig / findConfig', () => {
  it('reports invalid JSON as ConfigError', () => {
    const d = mkdtempSync(join(tmpdir(), 'gc-')); const f = join(d, 'groundcontrol.json');
    writeFileSync(f, '{ nope');
    expect(() => loadConfig(f)).toThrow(ConfigError);
  });
  it('finds the config walking upward', () => {
    const d = mkdtempSync(join(tmpdir(), 'gc-')); const f = join(d, 'groundcontrol.json');
    writeFileSync(f, '{}'); mkdirSync(join(d, 'a/b'), { recursive: true });
    expect(findConfig(join(d, 'a/b'))).toBe(f);
  });
  it('returns null when there is none', () => {
    expect(findConfig(mkdtempSync(join(tmpdir(), 'gc-none-')))).toBeNull();
  });
});
