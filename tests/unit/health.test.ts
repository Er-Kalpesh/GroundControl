import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitUntilReady } from '../../src/core/health.js';
import { LogStore } from '../../src/core/log-store.js';
import { getFreePort } from '../helpers.js';

const alive = { isAlive: () => true };
const mkLog = () => { const l = new LogStore(join(mkdtempSync(join(tmpdir(), 'gc-')), 'l.log')); l.start(); return l; };
const logs: LogStore[] = []; const servers: { close(): void }[] = [];
afterEach(() => { logs.splice(0).forEach(l => l.stop()); servers.splice(0).forEach(s => s.close()); });

describe('waitUntilReady', () => {
  it('is ready immediately without a health config', async () => {
    expect(await waitUntilReady(undefined, { log: mkLog(), ...alive })).toEqual({ ok: true });
  });
  it('http: waits through 503s until 200', async () => {
    let n = 0; const port = await getFreePort();
    const s = http.createServer((_, r) => { r.statusCode = ++n <= 2 ? 503 : 200; r.end(); }).listen(port, '127.0.0.1'); servers.push(s);
    const r = await waitUntilReady({ type: 'http', url: `http://127.0.0.1:${port}/`, expectStatus: 200, intervalMs: 30, timeoutMs: 3000 }, { log: mkLog(), ...alive });
    expect(r.ok).toBe(true); expect(n).toBeGreaterThanOrEqual(3);
  });
  it('tcp: ok when listening', async () => {
    const port = await getFreePort(); const s = net.createServer().listen(port, '127.0.0.1'); servers.push(s);
    expect((await waitUntilReady({ type: 'tcp', host: '127.0.0.1', port, intervalMs: 30, timeoutMs: 2000 }, { log: mkLog(), ...alive })).ok).toBe(true);
  });
  it('tcp: times out on a closed port', async () => {
    const port = await getFreePort();
    const r = await waitUntilReady({ type: 'tcp', host: '127.0.0.1', port, intervalMs: 30, timeoutMs: 300 }, { log: mkLog(), ...alive });
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/timed out/);
  });
  it('log: matches a line that appears later', async () => {
    const log = mkLog(); logs.push(log); setTimeout(() => writeSync(log.fd(), 'Server ready on 5173\n'), 250);
    expect((await waitUntilReady({ type: 'log', pattern: 'ready on \\d+', timeoutMs: 3000 }, { log, ...alive })).ok).toBe(true);
  });
  it('log: matches a line that already exists', async () => {
    const log = mkLog(); logs.push(log); writeSync(log.fd(), 'already ready\n'); log.stop(); log.start();
    expect((await waitUntilReady({ type: 'log', pattern: 'already ready', timeoutMs: 1000 }, { log, ...alive })).ok).toBe(true);
  });
  it('log: times out', async () => {
    const log = mkLog(); logs.push(log);
    const r = await waitUntilReady({ type: 'log', pattern: 'never', timeoutMs: 300 }, { log, ...alive });
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/never/);
  });
  it('aborts early when the process exits', async () => {
    const port = await getFreePort();
    const r = await waitUntilReady({ type: 'tcp', host: '127.0.0.1', port, intervalMs: 30, timeoutMs: 5000 }, { log: mkLog(), isAlive: () => false });
    expect(r).toEqual({ ok: false, reason: 'process exited' });
  });
});
