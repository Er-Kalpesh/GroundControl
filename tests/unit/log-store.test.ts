import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LogStore } from '../../src/core/log-store.js';
import { waitFor } from '../helpers.js';

const stores: LogStore[] = [];
function mk(opts = {}) {
  const file = join(mkdtempSync(join(tmpdir(), 'gc-')), 'a.log');
  const s = new LogStore(file, opts); stores.push(s); return { s, file };
}
afterEach(() => { for (const s of stores.splice(0)) s.stop(); });

describe('LogStore', () => {
  it('tails written lines and caps memory', async () => {
    const { s } = mk({ memoryLines: 3 }); const fd = s.fd(); s.start();
    for (const l of ['1', '2', '3', '4']) writeSync(fd, l + '\n');
    await waitFor(() => s.tail(10).length === 3);
    expect(s.tail(10)).toEqual(['2', '3', '4']);
  });
  it('notifies subscribers once per line and joins partial writes', async () => {
    const { s } = mk(); const fd = s.fd(); s.start();
    const got: string[] = []; s.subscribe(l => got.push(l));
    writeSync(fd, 'hel'); await new Promise(r => setTimeout(r, 450));
    expect(got).toEqual([]);
    writeSync(fd, 'lo\n'); await waitFor(() => got.length === 1);
    expect(got).toEqual(['hello']);
  });
  it('unsubscribe stops notifications', async () => {
    const { s } = mk(); const fd = s.fd(); s.start();
    const got: string[] = []; const off = s.subscribe(l => got.push(l)); off();
    writeSync(fd, 'x\n'); await waitFor(() => s.tail(1).length === 1);
    expect(got).toEqual([]);
  });
  it('start() is idempotent (no duplicate lines)', async () => {
    const { s } = mk(); const fd = s.fd(); s.start(); s.start();
    writeSync(fd, 'once\n'); await waitFor(() => s.tail(5).length >= 1);
    await new Promise(r => setTimeout(r, 500));
    expect(s.tail(5)).toEqual(['once']);
  });
  it('since() returns only new complete lines', async () => {
    const { s } = mk(); const fd = s.fd(); s.start();
    writeSync(fd, 'a\nb\n'); await waitFor(() => s.tail(5).length === 2);
    const first = s.since(0); expect(first.lines).toEqual(['a', 'b']);
    writeSync(fd, 'c\npartial'); await waitFor(() => s.tail(5).length === 3);
    const second = s.since(first.offset); expect(second.lines).toEqual(['c']);
    expect(s.since(second.offset).lines).toEqual([]);
  });
  it('rotate() moves an oversized file aside and keeps working', async () => {
    const { s, file } = mk({ maxFileBytes: 50 }); const fd = s.fd(); s.start();
    writeSync(fd, 'x'.repeat(100) + '\n'); await waitFor(() => s.tail(5).length === 1);
    s.rotate();
    expect(existsSync(file + '.1')).toBe(true);
    writeSync(s.fd(), 'after\n'); await waitFor(() => s.tail(5).includes('after'));
  });
  it('loads existing file content on start (adoption case)', async () => {
    const { s } = mk(); writeSync(s.fd(), 'old1\nold2\n'); s.stop();
    const file = (s as any).file as string; const s2 = new LogStore(file); stores.push(s2); s2.start();
    expect(s2.tail(5)).toEqual(['old1', 'old2']);
  });
});
