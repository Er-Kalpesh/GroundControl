import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { paths } from '../paths.js';
import { findConfig, loadConfig } from '../config/load.js';
import { isPortFree } from '../core/ports.js';
import type { GcClient } from '../client/http-client.js';

export interface Check { name: string; ok: boolean; detail: string }
const has = (cmd: string, args: string[]) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };

/** Environment diagnostics. `client` may be null when the daemon is not running. */
export async function runDoctor(cwd: string, client: GcClient | null, daemonUp: boolean): Promise<Check[]> {
  const out: Check[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  out.push({ name: 'node >= 20', ok: major >= 20, detail: process.versions.node });
  out.push({ name: 'lsof available', ok: has('lsof', ['-v']) || has('lsof', ['-h']), detail: 'needed for port detection' });
  out.push({ name: 'ps available', ok: has('ps', ['-o', 'pid=', '-p', String(process.pid)]), detail: 'needed for metrics and pid-reuse protection' });
  const p = paths();
  if (existsSync(p.token)) {
    const mode = statSync(p.token).mode & 0o777;
    out.push({ name: 'token file mode 0600', ok: mode === 0o600, detail: `${p.token} is ${mode.toString(8)}` });
  }
  out.push({ name: 'daemon reachable', ok: daemonUp, detail: daemonUp ? 'running' : 'not running (it starts automatically on first use)' });
  const cfgFile = findConfig(cwd);
  if (!cfgFile) { out.push({ name: 'groundcontrol.json', ok: false, detail: `none found from ${cwd}; run "groundcontrol init"` }); return out; }
  try {
    const cfg = loadConfig(cfgFile);
    out.push({ name: 'groundcontrol.json valid', ok: true, detail: `${cfgFile} (${Object.keys(cfg.services).length} services)` });
    const running = new Map((client && daemonUp ? await client.services(cfg.project) : []).map(s => [s.name, s.state]));
    for (const [name, s] of Object.entries(cfg.services)) {
      if (!s.port) continue;
      const free = await isPortFree(s.port);
      const ours = ['running', 'ready', 'unhealthy', 'starting'].includes(running.get(name) ?? '');
      out.push({ name: `port ${s.port} (${name})`, ok: free || ours, detail: free ? 'free' : ours ? 'in use by this service' : 'in use by something else' });
    }
  } catch (e) { out.push({ name: 'groundcontrol.json valid', ok: false, detail: (e as Error).message }); }
  return out;
}
