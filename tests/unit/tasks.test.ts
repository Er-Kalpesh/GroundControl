import { describe, it, expect } from 'vitest';
import { runTask } from '../../src/core/tasks.js';

const o = { cwd: process.cwd(), timeoutMs: 5000 };
describe('runTask', () => {
  it('captures stdout and exit 0', async () => {
    const r = await runTask('echo hi', o); expect(r).toMatchObject({ stdout: 'hi\n', exitCode: 0, timedOut: false, truncated: false });
  });
  it('captures stderr and a non-zero exit without rejecting', async () => {
    const r = await runTask('echo oops >&2; exit 7', o); expect(r.exitCode).toBe(7); expect(r.stderr).toBe('oops\n');
  });
  it('uses the given cwd and env', async () => {
    const r = await runTask('pwd; echo $FOO', { cwd: '/tmp', timeoutMs: 5000, env: { FOO: 'bar' } });
    expect(r.stdout).toMatch(/tmp/); expect(r.stdout).toContain('bar');
  });
  it('kills the whole group on timeout', async () => {
    const t0 = Date.now(); const r = await runTask('sleep 30', { ...o, timeoutMs: 300 });
    expect(r.timedOut).toBe(true); expect(Date.now() - t0).toBeLessThan(3000);
  });
  it('keeps only the tail of huge output and flags truncation', async () => {
    const r = await runTask(`node -e "process.stdout.write('a'.repeat(100000)+'END')"`, { ...o, maxOutputBytes: 1000 });
    expect(r.truncated).toBe(true); expect(r.stdout.length).toBeLessThanOrEqual(1000); expect(r.stdout.endsWith('END')).toBe(true);
  });
});
