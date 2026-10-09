import { Command } from 'commander';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { paths } from '../paths.js';
import { findConfig } from '../config/load.js';
import { ensureDaemon, defaultPort, daemonEntry, readToken } from '../client/ensure-daemon.js';
import { GcClient, GcError } from '../client/http-client.js';
import { isAlive } from '../core/state-file.js';
import { statusTable } from './format.js';
import { detectConfig } from './init.js';
import { runDoctor } from './doctor.js';
import { plist, plistPath, LABEL } from './launchd.js';

const program = new Command('groundcontrol')
  .description('Persistent local dev-server orchestrator for humans and AI agents')
  .option('--json', 'machine-readable output')
  .version('0.1.0');
const json = () => !!program.opts().json;
const out = (human: string, data: unknown) => console.log(json() ? JSON.stringify(data, null, 2) : human);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Connect to (and if needed start) the daemon; register the project found from the cwd, if any. */
async function connect(): Promise<{ client: GcClient; project?: string }> {
  const client = await ensureDaemon({ actor: 'human:cli' });
  const cfg = findConfig(process.cwd());
  const project = cfg ? (await client.registerProject(cfg)).project as string : undefined;
  return { client, project };
}
const needProject = (p?: string) => {
  if (!p) throw new Error('no groundcontrol.json found from this directory; run "groundcontrol init"');
  return p;
};
const idOf = (project: string | undefined, svc: string) => (svc.includes('/') ? svc : `${needProject(project)}/${svc}`);

function action<A extends unknown[]>(fn: (...a: A) => Promise<void>) {
  return async (...a: A) => {
    try { await fn(...a); }
    catch (e) {
      if (e instanceof GcError && e.status === 409 && e.body?.port) {
        const o = e.body.owner;
        console.error(`error: port ${e.body.port} is in use${o ? ` by ${o.command} (pid ${o.pid})` : ''}.\n` +
          `       Re-run with --kill-zombies to stop that process, or free the port yourself.`);
      } else console.error(`error: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  };
}

program.command('init').description('create a starter groundcontrol.json in the current directory')
  .option('--force', 'overwrite an existing file')
  .action(action(async (o: { force?: boolean }) => {
    const file = join(process.cwd(), 'groundcontrol.json');
    if (existsSync(file) && !o.force) throw new Error(`${file} already exists (use --force to overwrite)`);
    const cfg = detectConfig(process.cwd());
    writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
    out(`wrote ${file}\nservices: ${Object.keys(cfg.services as object).join(', ') || '(none detected — edit the file)'}`, { file, config: cfg });
  }));

program.command('start [services...]').description('start services (and their dependencies) in order')
  .option('--kill-zombies', 'kill whatever already listens on a service port')
  .action(action(async (services: string[], o: { killZombies?: boolean }) => {
    const { client, project } = await connect();
    const p = needProject(project);
    const result = await client.up(p, services.length ? services : undefined, { killZombies: !!o.killZombies });
    out(statusTable(result), { services: result });
  }));

program.command('stop [services...]').description('stop services (all when none given)')
  .action(action(async (services: string[]) => {
    const { client, project } = await connect();
    const p = needProject(project);
    if (!services.length) await client.down(p); else for (const s of services) await client.stop(idOf(p, s));
    out(statusTable(await client.services(p)), { services: await client.services(p) });
  }));

program.command('restart <service>').option('--kill-zombies').description('restart one service')
  .action(action(async (svc: string, o: { killZombies?: boolean }) => {
    const { client, project } = await connect();
    const s = await client.restart(idOf(project, svc), { killZombies: !!o.killZombies });
    out(statusTable([s]), { service: s });
  }));

program.command('status').description('show service states')
  .action(action(async () => {
    const { client, project } = await connect();
    const list = await client.services(project);
    out(statusTable(list), { services: list });
  }));

program.command('logs <service>').description('print recent logs; -f to follow')
  .option('-n, --lines <n>', 'number of lines', '100').option('-f, --follow', 'follow new output')
  .action(action(async (svc: string, o: { lines: string; follow?: boolean }) => {
    const { client, project } = await connect();
    const id = idOf(project, svc);
    if (!o.follow) {
      const r = await client.logs(id, { tail: Number(o.lines) });
      out(r.lines.join('\n'), r);
      return;
    }
    const ac = new AbortController();
    process.on('SIGINT', () => { ac.abort(); });
    await client.streamLogs(id, l => console.log(l), ac.signal).catch(e => { if (!ac.signal.aborted) throw e; });
  }));

program.command('run <task-or-command>').description('run a declared task, or (as a human) any shell command')
  .action(action(async (what: string) => {
    const { client, project } = await connect();
    const p = needProject(project);
    const known = (await client.projects()).find(x => x.project === p)?.tasks ?? [];
    const r = await client.runTask(p, known.includes(what) ? { task: what } : { command: what });
    if (json()) console.log(JSON.stringify(r, null, 2));
    else { process.stdout.write(r.stdout); process.stderr.write(r.stderr); if (r.timedOut) console.error('(timed out)'); if (r.truncated) console.error('(output truncated)'); }
    process.exitCode = r.exitCode ?? 1;
  }));

program.command('ports <port>').description('show who uses a port').option('--kill', 'kill the process that listens on it')
  .action(action(async (port: string, o: { kill?: boolean }) => {
    const client = await ensureDaemon({ actor: 'human:cli' });
    const n = Number(port);
    const r = await client.port(n);
    if (o.kill && !r.free) { const killed = await client.killPort(n); out(killed ? `killed ${r.owner?.command} (pid ${r.owner?.pid})` : 'could not kill', { killed }); return; }
    out(r.free ? `port ${n} is free` : `port ${n} is used by ${r.owner?.command} (pid ${r.owner?.pid})`, r);
  }));

program.command('ui').description('open the dashboard').option('--no-open', 'print the URL instead of opening a browser')
  .action(action(async (o: { open: boolean }) => {
    await connect();
    const url = `http://127.0.0.1:${defaultPort()}/#token=${readToken()}`;
    if (o.open === false) { console.log(url + '\n(the URL contains your API token; do not share it)'); return; }
    execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
    console.log(`dashboard: http://127.0.0.1:${defaultPort()}/`);
  }));

program.command('mcp-server').description('run the MCP stdio bridge (for Claude, Cursor, Cline, ...)')
  .action(action(async () => {
    const { runMcpServer } = await import('../mcp/server.js');
    await runMcpServer();
  }));

program.command('doctor').description('diagnose the environment')
  .action(action(async () => {
    const probe = new GcClient({ port: defaultPort(), token: 'x', actor: 'human:cli' });
    const up = await probe.health();
    const client = up && existsSync(paths().token) ? new GcClient({ port: defaultPort(), token: readToken(), actor: 'human:cli' }) : null;
    const checks = await runDoctor(process.cwd(), client, up);
    out(checks.map(c => `${c.ok ? 'ok  ' : 'FAIL'}  ${c.name} — ${c.detail}`).join('\n'), { checks });
    if (checks.some(c => !c.ok && c.name !== 'daemon reachable')) process.exitCode = 1;
  }));

const daemon = program.command('daemon').description('manage the background daemon');
daemon.command('start').action(action(async () => { await ensureDaemon(); out(`daemon running on port ${defaultPort()}`, { running: true }); }));
daemon.command('status').action(action(async () => {
  const up = await new GcClient({ port: defaultPort(), token: 'x', actor: 'human:cli' }).health();
  const pid = existsSync(paths().daemonPid) ? Number(readFileSync(paths().daemonPid, 'utf8')) : null;
  out(up ? `running (pid ${pid}) on port ${defaultPort()}` : 'not running', { running: up, pid });
}));
daemon.command('stop').description('stop the daemon (services keep running unless --with-services)')
  .option('--with-services', 'also stop every managed service')
  .action(action(async (o: { withServices?: boolean }) => {
    const p = paths();
    if (!existsSync(p.daemonPid)) { out('daemon is not running', { running: false }); return; }
    const pid = Number(readFileSync(p.daemonPid, 'utf8'));
    if (o.withServices) {
      const client = await ensureDaemon({ actor: 'human:cli' });
      for (const pr of await client.projects()) await client.down(pr.project);
    }
    if (isAlive(pid)) process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 60 && isAlive(pid); i++) await sleep(100);
    out(o.withServices ? 'daemon and services stopped' : 'daemon stopped; services keep running', { stopped: !isAlive(pid) });
  }));
daemon.command('install').description('start the daemon automatically at login (macOS launchd)')
  .action(action(async () => {
    if (process.platform !== 'darwin') throw new Error('daemon install is macOS-only; use systemd --user on Linux');
    const p = paths();
    const file = plistPath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, plist({
      node: process.execPath, daemon: daemonEntry(), path: process.env.PATH ?? '/usr/bin:/bin',
      home: process.env.GROUNDCONTROL_HOME, port: process.env.GROUNDCONTROL_PORT ? Number(process.env.GROUNDCONTROL_PORT) : undefined,
      logFile: p.daemonLog,
    }));
    const uid = String(process.getuid?.() ?? 501);
    try { execFileSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' }); } catch { /* not loaded yet */ }
    execFileSync('launchctl', ['bootstrap', `gui/${uid}`, file]);
    out(`installed ${file}`, { installed: file });
  }));
daemon.command('uninstall').action(action(async () => {
  const uid = String(process.getuid?.() ?? 501);
  try { execFileSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' }); } catch { /* not loaded */ }
  try { unlinkSync(plistPath()); } catch { /* absent */ }
  out('uninstalled', { installed: false });
}));

program.parseAsync(process.argv);
