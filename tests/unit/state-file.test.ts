import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateFile, isAlive, processStartTime } from '../../src/core/state-file.js';

const entry = { id: 'p/s', pid: 1, pgid: 1, startedAt: 5, command: 'x', cwd: '/', logFile: '/l' };

describe('StateFile', () => {
  it('round-trips', () => {
    const f = new StateFile(join(mkdtempSync(join(tmpdir(), 'gc-')), 's.json'));
    f.save({ 'p/s': entry }); expect(f.load()).toEqual({ 'p/s': entry });
  });
  it('returns {} for a missing file', () => {
    expect(new StateFile(join(mkdtempSync(join(tmpdir(), 'gc-')), 'none.json')).load()).toEqual({});
  });
  it('returns {} for a corrupt file', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'gc-')), 's.json'); writeFileSync(p, '{{{');
    expect(new StateFile(p).load()).toEqual({});
  });
});
describe('process probes', () => {
  it('isAlive', () => { expect(isAlive(process.pid)).toBe(true); expect(isAlive(999999)).toBe(false); });
  it('processStartTime is close to our own start', () => {
    const t = processStartTime(process.pid)!;
    expect(Math.abs(t - (Date.now() - process.uptime() * 1000))).toBeLessThan(5000);
  });
  it('processStartTime is null for a dead pid', () => { expect(processStartTime(999999)).toBeNull(); });
});
