import { spawn, exec } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { LogStore } from './log-store.js';
import { StateFile, isAlive, processStartTime, type PersistedService } from './state-file.js';
import type { ServiceConfig } from '../config/load.js';
import type { ServiceStatus } from '../types.js';

interface Entry {
  status: ServiceStatus;
  cfg: ServiceConfig;
  log: LogStore;
  persisted?: PersistedService;
  exitWatcher?: NodeJS.Timeout;
  stopping?: boolean;
  exited?: boolean;
}

const LIVE = ['starting', 'running', 'ready', 'unhealthy'];
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const groupAlive = (pgid: number) => {
  try { process.kill(-pgid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

export class ProcessManager extends EventEmitter {
  private entries = new Map<string, Entry>();

  constructor(private opts: { stateFile: StateFile; logsDir: string }) { super(); }

  private logFile(id: string) { return join(this.opts.logsDir, id.replace('/', '__') + '.log'); }

  private persist() {
    const all: Record<string, PersistedService> = {};
    for (const [id, e] of this.entries) if (e.persisted && groupAlive(e.persisted.pgid)) all[id] = e.persisted;
    this.opts.stateFile.save(all);
  }

  private set(e: Entry, patch: Partial<ServiceStatus>) {
    Object.assign(e.status, patch);
    this.emit('state', { ...e.status });
  }

  /** Spawn a service in its own process group with stdout/stderr going straight to its log file. */
  async start(id: string, project: string, name: string, cfg: ServiceConfig): Promise<ServiceStatus> {
    const existing = this.entries.get(id);
    if (existing && LIVE.includes(existing.status.state)) {
      throw new Error(`${id} is already running (pid ${existing.status.pid})`);
    }
    const log = existing?.log ?? new LogStore(this.logFile(id));
    log.rotate();                       // safe: nothing is writing right now
    const fd = log.fd();
    log.start();
    const child = spawn('/bin/sh', ['-c', cfg.command], {
      cwd: cfg.cwd,
      env: { ...process.env, ...cfg.env, ...(cfg.port ? { PORT: String(cfg.port) } : {}) },
      detached: true,                   // new session + process group: survives the daemon, killable as a group
      stdio: ['ignore', fd, fd],
    });
    child.unref();
    const pid = child.pid;
    if (!pid) throw new Error(`failed to spawn ${id}`);
    const startedAt = Date.now();
    const e: Entry = {
      cfg, log,
      status: { id, project, name, state: 'running', pid, port: cfg.port, startedAt, restarts: existing?.status.restarts ?? 0 },
      persisted: { id, pid, pgid: pid, startedAt, command: cfg.command, cwd: cfg.cwd, logFile: this.logFile(id) },
    };
    this.entries.set(id, e);
    this.persist();
    child.on('exit', (code, signal) => this.onExit(e, code, signal));
    child.on('error', err => { this.set(e, { state: 'crashed', lastError: err.message, pid: undefined }); });
    this.set(e, {});
    return { ...e.status };
  }

  private onExit(e: Entry, code: number | null, signal: NodeJS.Signals | null) {
    if (e.exited) return;               // 'exit' event and explicit stop() can both arrive; handle once
    e.exited = true;
    if (e.exitWatcher) clearInterval(e.exitWatcher);
    const clean = !!e.stopping || code === 0;
    const reason = code === null && signal === null ? 'exited (code unknown)' : `exited with ${signal ?? code}`;
    this.set(e, {
      state: clean ? 'stopped' : 'crashed', exitCode: code, pid: undefined,
      lastError: clean ? undefined : reason,
    });
    e.persisted = undefined;
    this.persist();
    this.emit('exit', { ...e.status, expected: !!e.stopping });
  }

  /** Graceful stop of the whole process group: stopCommand, SIGTERM, wait, SIGKILL. */
  async stop(id: string): Promise<void> {
    const e = this.entries.get(id);
    if (!e || !e.persisted || e.exited) return;
    e.stopping = true;
    this.set(e, { state: 'stopping' });
    if (e.cfg.stopCommand) {
      await new Promise<void>(r => exec(e.cfg.stopCommand!, { cwd: e.cfg.cwd, timeout: 30_000 }, () => r()));
    }
    const pgid = e.persisted.pgid;
    try { process.kill(-pgid, 'SIGTERM'); } catch { /* group already gone */ }
    const deadline = Date.now() + e.cfg.stopTimeoutMs;
    while (Date.now() < deadline && groupAlive(pgid)) await sleep(50);
    if (groupAlive(pgid)) { try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone meanwhile */ } }
    while (groupAlive(pgid)) await sleep(25);
    this.onExit(e, null, 'SIGTERM');    // no-op if the real 'exit' event already ran
  }

  status(id?: string): ServiceStatus[] {
    return [...this.entries.values()].map(e => ({ ...e.status })).filter(s => !id || s.id === id);
  }

  logs(id: string): LogStore | undefined { return this.entries.get(id)?.log; }

  /** On daemon boot: re-attach to services that are still alive according to the state file. */
  adoptAll() {
    for (const [id, p] of Object.entries(this.opts.stateFile.load())) {
      const started = processStartTime(p.pid);
      if (!isAlive(p.pid) || started === null || Math.abs(started - p.startedAt) > 5000) continue;   // dead, or pid reused
      const [project, name] = id.split('/') as [string, string];
      const log = new LogStore(p.logFile);
      log.start();
      const e: Entry = {
        cfg: { command: p.command, cwd: p.cwd, stopTimeoutMs: 10_000 } as ServiceConfig,
        log, persisted: p,
        status: { id, project, name, state: 'running', pid: p.pid, startedAt: p.startedAt, restarts: 0 },
      };
      this.entries.set(id, e);
      e.exitWatcher = setInterval(() => { if (!groupAlive(p.pgid)) this.onExit(e, null, null); }, 1000);
      e.exitWatcher.unref();
      this.set(e, {});
    }
  }

  /** Give an adopted entry its real config (stopCommand, timeouts, port). */
  attachConfig(id: string, cfg: ServiceConfig) {
    const e = this.entries.get(id);
    if (e) { e.cfg = cfg; e.status.port = cfg.port; }
  }

  /** Orchestrator calls this when the readiness probe finishes. Ignored unless still starting/running. */
  markReady(id: string, r: { ok: boolean; reason?: string }) {
    const e = this.entries.get(id);
    if (!e || !['running', 'unhealthy'].includes(e.status.state)) return;
    this.set(e, r.ok ? { state: 'ready', lastError: undefined } : { state: 'unhealthy', lastError: r.reason });
  }

  setRestarts(id: string, n: number) {
    const e = this.entries.get(id);
    if (e) e.status.restarts = n;
  }

  async shutdown(opts: { killChildren: boolean }) {
    if (opts.killChildren) for (const id of [...this.entries.keys()]) await this.stop(id);
    for (const e of this.entries.values()) {
      if (e.exitWatcher) clearInterval(e.exitWatcher);
      e.log.stop();
    }
  }
}
