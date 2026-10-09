import { it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseShellPath, mergePath, resolveUserPath, loadCachedPath, saveCachedPath } from '../../src/core/shell-env.js';

it('parses PATH between markers and ignores rc-file noise', () => {
  expect(parseShellPath('Welcome!\n__GC_PATH_START__/a:/b__GC_PATH_END__\nbye')).toBe('/a:/b');
  expect(parseShellPath('no markers')).toBeNull();
  expect(parseShellPath('__GC_PATH_START____GC_PATH_END__')).toBeNull();
});
it('merges PATH lists, deduplicating and keeping first-seen order', () => {
  expect(mergePath('/a:/b', '/b:/c', undefined, '::/d')).toBe('/a:/b:/c:/d');
});
it('resolves a real login-shell PATH', async () => {
  const p = await resolveUserPath();
  expect(p).toContain('/usr/bin');
}, 40000);
it('caches the PATH on disk and tolerates a missing cache', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'gc-')), 'shell-path');
  expect(loadCachedPath(f)).toBeNull();
  saveCachedPath(f, '/a:/b'); expect(loadCachedPath(f)).toBe('/a:/b');
});
