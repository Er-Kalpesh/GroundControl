import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { isPortFree, portOwner, killPortOwner } from '../../src/core/ports.js';
import { getFreePort, waitFor } from '../helpers.js';

const listen = (port: number, host: string) => new Promise<net.Server>(res => { const s = net.createServer(); s.listen(port, host, () => res(s)); });
const close = (s: net.Server) => new Promise<void>(r => s.close(() => r()));

describe('ports', () => {
  it('detects a busy and then free port on 127.0.0.1', async () => {
    const port = await getFreePort(); const s = await listen(port, '127.0.0.1');
    expect(await isPortFree(port)).toBe(false);
    expect((await portOwner(port))!.pid).toBe(process.pid);
    await close(s); expect(await isPortFree(port)).toBe(true);
  });
  it('detects a wildcard (0.0.0.0) listener too', async () => {
    const port = await getFreePort(); const s = await listen(port, '0.0.0.0');
    expect(await isPortFree(port)).toBe(false); await close(s);
  });
  it('kills a foreign listener and frees the port', async () => {
    const port = await getFreePort();
    const child = spawn(process.execPath, ['-e', `require('net').createServer().listen(${port},'127.0.0.1');setInterval(()=>{},1000)`], { stdio: 'ignore' });
    await waitFor(async () => !(await isPortFree(port)));
    expect(await killPortOwner(port)).toBe(true);
    expect(await isPortFree(port)).toBe(true); child.kill();
  });
  it('refuses to kill its own process', async () => {
    const port = await getFreePort(); const s = await listen(port, '127.0.0.1');
    expect(await killPortOwner(port)).toBe(false); await close(s);
  });
  it('returns false when nobody listens', async () => {
    expect(await killPortOwner(await getFreePort())).toBe(false);
  });
});
