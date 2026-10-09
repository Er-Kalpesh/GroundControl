import { it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from '../../src/core/audit.js';

const mk = () => new AuditLog(join(mkdtempSync(join(tmpdir(), 'gc-')), 'audit.log'));
it('records and returns the most recent entries in order', () => {
  const a = mk();
  a.record({ kind: 'human', name: 'cli' }, 'start', 'p/a');
  a.record({ kind: 'ai', name: 'claude' }, 'stop', 'p/a');
  a.record({ kind: 'system', name: 'restart-policy' }, 'start', 'p/b', { attempt: 1 });
  const r = a.recent(2);
  expect(r.map(e => e.action)).toEqual(['stop', 'start']);
  expect(r[0]!.actor).toEqual({ kind: 'ai', name: 'claude' });
  expect(r[1]!.detail).toEqual({ attempt: 1 });
});
it('returns [] when the file does not exist yet', () => { expect(mk().recent(5)).toEqual([]); });
