import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../paths.js';
import { ensureToken } from './security.js';
import { buildServer } from './server.js';
import { ProcessManager } from '../core/process-manager.js';
import { StateFile, isAlive } from '../core/state-file.js';
import { AuditLog } from '../core/audit.js';
import { Orchestrator } from '../core/orchestrator.js';
import { mergePath, resolveUserPath, loadCachedPath, saveCachedPath } from '../core/shell-env.js';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const log = (m: string) => process.stderr.write(`[groundcontrol] ${m}\n`);

async function main() {
  const p = paths();
  mkdirSync(p.home, { recursive: true, mode: 0o700 });

  if (existsSync(p.daemonPid)) {
    const old = Number(readFileSync(p.daemonPid, 'utf8'));
    if (old && isAlive(old)) { log(`daemon already running (pid ${old})`); process.exit(1); }
  }

  // Services need the user's real PATH (php, npm, docker...), which a GUI-launched daemon does not inherit.
  // Use the cached value instantly and refresh it in the background; only the very first start waits.
  if (process.env.GROUNDCONTROL_SKIP_SHELL_PATH !== '1') {
    const apply = (userPath: string | null) => {
      if (!userPath) return;
      process.env.PATH = mergePath(userPath, process.env.PATH);
      saveCachedPath(p.shellPath, userPath);
    };
    const cached = loadCachedPath(p.shellPath);
    if (cached) { process.env.PATH = mergePath(cached, process.env.PATH); void resolveUserPath().then(apply); }
    else apply(await resolveUserPath());
  }

  const port = Number(process.env.GROUNDCONTROL_PORT ?? 9876);
  const token = ensureToken(p.token);
  const pm = new ProcessManager({ stateFile: new StateFile(p.state), logsDir: p.logsDir });
  const audit = new AuditLog(p.audit);
  const orch = new Orchestrator({ pm, audit, registryFile: p.projects });
  pm.adoptAll();              // 1. re-attach to services that survived the previous daemon
  orch.restoreProjects();     // 2. then give them their configs back

  const app = buildServer({
    orch, audit, token, port,
    dashboardDir: join(dirname(fileURLToPath(import.meta.url)), '../dashboard'),
  });
  try { await app.listen({ host: '127.0.0.1', port }); }
  catch (e) { log(`cannot listen on 127.0.0.1:${port}: ${(e as Error).message}`); process.exit(1); }
  writeFileSync(p.daemonPid, String(process.pid));
  log(`listening on http://127.0.0.1:${port} (pid ${process.pid})`);

  if (process.env.GROUNDCONTROL_BOOT === '1') await orch.autostart();

  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    orch.dispose();
    await Promise.race([app.close(), sleep(1500)]);        // open SSE streams must not block shutdown
    await pm.shutdown({ killChildren: false });            // children keep running: the product's core promise
    try { unlinkSync(p.daemonPid); } catch { /* already removed */ }
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch(e => { process.stderr.write(String((e as Error)?.stack ?? e) + '\n'); process.exit(1); });
