import net from 'node:net';
import { execFile } from 'node:child_process';

const run = (cmd: string, args: string[]) =>
  new Promise<string>(resolve => execFile(cmd, args, (_err, out) => resolve(out ?? '')));

const canBind = (port: number, host: string) => new Promise<boolean>(resolve => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.once('listening', () => s.close(() => resolve(true)));
  s.listen(port, host);
});

/** Who is LISTENing on this TCP port (any interface), or null. */
export async function portOwner(port: number): Promise<{ pid: number; command: string } | null> {
  const out = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
  const pid = out.match(/^p(\d+)/m)?.[1];
  const command = out.match(/^c(.+)$/m)?.[1];
  return pid ? { pid: Number(pid), command: command ?? '?' } : null;
}

/**
 * Free = nobody listens (lsof, authoritative: a bind() test alone is wrong on macOS, where binding
 * 127.0.0.1:p succeeds while another process holds 0.0.0.0:p) AND we can actually bind it.
 */
export async function isPortFree(port: number): Promise<boolean> {
  if (await portOwner(port)) return false;
  return canBind(port, '127.0.0.1');
}

/** SIGTERM the listener, wait up to 3 s, then SIGKILL. Refuses to kill this process or its parent. */
export async function killPortOwner(port: number): Promise<boolean> {
  const o = await portOwner(port);
  if (!o || o.pid === process.pid || o.pid === process.ppid) return false;
  try { process.kill(o.pid, 'SIGTERM'); } catch { return false; }
  for (let i = 0; i < 30; i++) {
    if (await isPortFree(port)) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  try { process.kill(o.pid, 'SIGKILL'); } catch { /* already gone */ }
  await new Promise(r => setTimeout(r, 200));
  return isPortFree(port);
}
