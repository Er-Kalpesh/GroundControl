import { spawn } from 'node:child_process';
import { existsSync, readFileSync, openSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { paths } from '../paths.js';
import { GcClient } from './http-client.js';

export const defaultPort = () => Number(process.env.GROUNDCONTROL_PORT ?? 9876);
export const readToken = () => readFileSync(paths().token, 'utf8').trim();
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Path of the daemon entry. In the published bundle every entry sits one directory below dist/. */
export const daemonEntry = () =>
  process.env.GROUNDCONTROL_DAEMON_ENTRY ?? fileURLToPath(new URL('../daemon/main.js', import.meta.url));

/** Return a client for the running daemon, starting a detached daemon first if none answers. */
export async function ensureDaemon(o: { port?: number; actor?: string } = {}): Promise<GcClient> {
  const port = o.port ?? defaultPort();
  const actor = o.actor ?? 'human:cli';
  const probe = new GcClient({ port, token: 'x', actor });
  if (!(await probe.health())) {
    const p = paths();
    mkdirSync(p.home, { recursive: true, mode: 0o700 });
    const out = openSync(p.daemonLog, 'a');
    spawn(process.execPath, [daemonEntry()], { detached: true, stdio: ['ignore', out, out], env: process.env }).unref();
    const deadline = Date.now() + 40_000;                      // the very first start resolves the login-shell PATH (slow rc files)
    while (Date.now() < deadline) {
      if ((await probe.health()) && existsSync(p.token)) break;
      await sleep(100);
    }
    if (!(await probe.health())) throw new Error(`daemon did not start; see ${p.daemonLog}`);
  }
  return new GcClient({ port, token: readToken(), actor });
}
