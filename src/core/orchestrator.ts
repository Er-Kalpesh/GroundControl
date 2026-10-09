import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig, startOrder, type ProjectConfig } from '../config/load.js';
import type { ProcessManager } from './process-manager.js';
import type { AuditLog } from './audit.js';
import type { LogStore } from './log-store.js';
import { nextRestart } from './restart-policy.js';
import { isPortFree, portOwner, killPortOwner } from './ports.js';
import { waitUntilReady } from './health.js';
import { runTask as execTask } from './tasks.js';
import { sampleGroup, type Sample } from './metrics.js';
import { canRunTask } from '../daemon/security.js';
import type { Actor, ServiceStatus, TaskResult } from '../types.js';

export class PortInUseError extends Error {
  constructor(public port: number, public owner: { pid: number; command: string } | null) {
    super(`port ${port} is in use${owner ? ` by ${owner.command} (pid ${owner.pid})` : ''}`);
  }
}
export class PolicyError extends Error {}

const LIVE = ['starting', 'running', 'ready', 'unhealthy'];
const SYSTEM: Actor = { kind: 'system', name: 'restart-policy' };
const BOOT: Actor = { kind: 'system', name: 'boot' };

export class Orchestrator extends EventEmitter {
  private projects = new Map<string, ProjectConfig>();
  private attempts = new Map<string, number>();
  private restartTimers = new Map<string, NodeJS.Timeout>();
  private stableTimers = new Map<string, NodeJS.Timeout>();
  private metrics = new Map<string, { at: number; v: Sample | null }>();
  private stableMs: number;

  constructor(private deps: { pm: ProcessManager; audit: AuditLog; registryFile?: string; stableMs?: number }) {
    super();
    this.stableMs = deps.stableMs ?? 60_000;
    deps.pm.on('state', (s: ServiceStatus) => { this.emit('state', s); this.onState(s); });
    deps.pm.on('exit', (s: ServiceStatus & { expected: boolean }) => this.onExit(s));
  }

  /** Cancel every pending timer (restart backoffs, stability windows). Call before discarding the orchestrator. */
  dispose() {
    for (const t of [...this.restartTimers.values(), ...this.stableTimers.values()]) clearTimeout(t);
    this.restartTimers.clear(); this.stableTimers.clear();
  }

  // ---------- projects ----------
  registerProject(configFile: string): ProjectConfig {
    const cfg = loadConfig(configFile);
    startOrder(cfg);                                     // fail early on cycles / unknown dependencies
    this.projects.set(cfg.project, cfg);
    for (const [name, svc] of Object.entries(cfg.services)) this.deps.pm.attachConfig(`${cfg.project}/${name}`, svc);
    this.saveRegistry();
    return cfg;
  }
  private saveRegistry() {
    const f = this.deps.registryFile; if (!f) return;
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify([...this.projects.values()].map(p => p.file), null, 2), { mode: 0o600 });
  }
  restoreProjects() {
    const f = this.deps.registryFile; if (!f || !existsSync(f)) return;
    let files: string[] = [];
    try { files = JSON.parse(readFileSync(f, 'utf8')); } catch { return; }
    for (const file of files) {
      try { this.registerProject(file); }
      catch (e) { this.deps.audit.record(BOOT, 'restore-skipped', file, { error: String(e) }); }
    }
  }
  listProjects() {
    return [...this.projects.values()].map(p => ({
      project: p.project, root: p.root, file: p.file, services: Object.keys(p.services), tasks: Object.keys(p.tasks),
    }));
  }
  getProject(project: string): ProjectConfig {
    const p = this.projects.get(project);
    if (!p) throw new Error(`unknown project ${project}`);
    return p;
  }
  logs(id: string): LogStore | undefined { return this.deps.pm.logs(id); }
  private svc(id: string) {
    const [project, name] = id.split('/') as [string, string];
    const cfg = this.projects.get(project)?.services[name];
    if (!cfg) throw new Error(`unknown service ${id}`);
    return { project, name, cfg };
  }

  // ---------- single service ----------
  async startService(id: string, actor: Actor, opts: { killZombies?: boolean } = {}): Promise<ServiceStatus> {
    const { project, name, cfg } = this.svc(id);
    this.clearTimers(id);
    if (cfg.port && !(await isPortFree(cfg.port))) {
      const owner = await portOwner(cfg.port);
      if (!opts.killZombies || !(await killPortOwner(cfg.port))) throw new PortInUseError(cfg.port, owner);
    }
    this.deps.audit.record(actor, 'start', id);
    const st = await this.deps.pm.start(id, project, name, cfg);
    this.deps.pm.setRestarts(id, this.attempts.get(id) ?? 0);
    const live = () => LIVE.includes(this.deps.pm.status(id)[0]?.state ?? '');
    void waitUntilReady(cfg.health, { log: this.deps.pm.logs(id)!, isAlive: live })
      .then(r => this.deps.pm.markReady(id, r));
    return st;
  }
  async stopService(id: string, actor: Actor) {
    this.svc(id);
    this.clearTimers(id);
    this.attempts.set(id, 0);
    this.deps.audit.record(actor, 'stop', id);
    await this.deps.pm.stop(id);
  }
  async restartService(id: string, actor: Actor, opts: { killZombies?: boolean } = {}) {
    this.deps.audit.record(actor, 'restart', id);
    await this.stopService(id, actor);
    return this.startService(id, actor, opts);
  }
  private clearTimers(id: string) {
    clearTimeout(this.restartTimers.get(id)); this.restartTimers.delete(id);
    clearTimeout(this.stableTimers.get(id)); this.stableTimers.delete(id);
  }

  // ---------- whole project ----------
  /** Start order restricted to `only` plus their transitive dependencies. */
  private closure(cfg: ProjectConfig, only?: string[]) {
    const order = startOrder(cfg);
    if (!only?.length) return order;
    const need = new Set<string>();
    const add = (n: string) => {
      if (!cfg.services[n]) throw new Error(`unknown service ${cfg.project}/${n}`);
      if (need.has(n)) return;
      need.add(n);
      cfg.services[n]!.dependsOn.forEach(add);
    };
    only.forEach(add);
    return order.filter(n => need.has(n));
  }
  /** Resolve when the service reaches ready/unhealthy/crashed/stopped. */
  private settle(id: string, timeoutMs: number) {
    return new Promise<ServiceStatus>((resolve, reject) => {
      const done = (s: ServiceStatus) => ['ready', 'unhealthy', 'crashed', 'stopped'].includes(s.state);
      const cur = this.deps.pm.status(id)[0];
      if (cur && done(cur)) return resolve(cur);
      const off = () => this.off('state', on);
      const t = setTimeout(() => { off(); reject(new Error(`${id} did not settle within ${timeoutMs}ms`)); }, timeoutMs);
      const on = (s: ServiceStatus) => { if (s.id === id && done(s)) { off(); clearTimeout(t); resolve(s); } };
      this.on('state', on);
    });
  }
  async up(project: string, actor: Actor, only?: string[], opts: { killZombies?: boolean } = {}): Promise<ServiceStatus[]> {
    const cfg = this.getProject(project);
    this.deps.audit.record(actor, 'up', project, { only });
    const result: ServiceStatus[] = [];
    for (const name of this.closure(cfg, only)) {
      const id = `${project}/${name}`;
      const s = cfg.services[name]!;
      const existing = this.deps.pm.status(id)[0];
      if (!existing || !LIVE.includes(existing.state)) await this.startService(id, actor, opts);
      const final = await this.settle(id, (s.health?.timeoutMs ?? 0) + 5000);
      if (final.state !== 'ready') throw new Error(`${id} failed: ${final.lastError ?? final.state}`);
      result.push(final);
    }
    return result;
  }
  async down(project: string, actor: Actor) {
    const cfg = this.getProject(project);
    this.deps.audit.record(actor, 'down', project);
    for (const name of startOrder(cfg).reverse()) await this.stopService(`${project}/${name}`, actor);
  }
  /** Boot-time only (GROUNDCONTROL_BOOT=1): bring up every service with autostart=true. */
  async autostart() {
    for (const p of this.projects.values()) {
      const names = Object.entries(p.services).filter(([, s]) => s.autostart).map(([n]) => n);
      if (!names.length) continue;
      await this.up(p.project, BOOT, names)
        .catch(e => this.deps.audit.record(BOOT, 'autostart-failed', p.project, { error: String(e) }));
    }
  }

  // ---------- automatic restart ----------
  private onState(s: ServiceStatus) {
    clearTimeout(this.stableTimers.get(s.id));
    if (s.state === 'ready') {
      this.stableTimers.set(s.id, setTimeout(() => {
        this.attempts.set(s.id, 0); this.deps.pm.setRestarts(s.id, 0);
      }, this.stableMs));
    }
  }
  private onExit(s: ServiceStatus & { expected: boolean }) {
    clearTimeout(this.stableTimers.get(s.id));
    const cfg = this.projects.get(s.project)?.services[s.name];
    if (!cfg) return;
    const attempt = this.attempts.get(s.id) ?? 0;
    const d = nextRestart(cfg.restart.policy, attempt, cfg.restart.maxRetries, cfg.restart.backoffMs, s.expected, s.exitCode ?? null);
    if (!d.restart) return;
    this.attempts.set(s.id, attempt + 1);
    this.restartTimers.set(s.id, setTimeout(() => {
      this.startService(s.id, SYSTEM)
        .catch(e => this.deps.audit.record(SYSTEM, 'restart-failed', s.id, { error: String(e) }));
    }, d.delayMs));
  }

  // ---------- tasks ----------
  async runTask(project: string, arg: { task?: string; command?: string }, actor: Actor): Promise<TaskResult> {
    const cfg = this.getProject(project);
    if (!!arg.task === !!arg.command) throw new Error('provide exactly one of "task" or "command"');
    const verdict = canRunTask(actor, { taskName: arg.task, command: arg.command }, cfg.policy);
    if (!verdict.allowed) {
      this.deps.audit.record(actor, 'task-denied', project, { arg });
      throw new PolicyError(verdict.reason!);
    }
    let command: string, cwd = cfg.root, timeoutMs = 300_000;
    if (arg.task) {
      const t = cfg.tasks[arg.task];
      if (!t) throw new Error(`unknown task "${arg.task}" in project ${project}`);
      ({ command, cwd, timeoutMs } = t);
    } else command = arg.command!;
    this.deps.audit.record(actor, 'task', project, { task: arg.task, command });
    return execTask(command, { cwd, timeoutMs });
  }

  // ---------- status ----------
  /** Every configured service (stopped ones included) with cpu/memory for running ones (cached 2 s). */
  async statuses(project?: string): Promise<ServiceStatus[]> {
    const list = this.deps.pm.status().filter(s => !project || s.project === project);
    const known = new Set(list.map(s => s.id));
    for (const p of this.projects.values()) {
      if (project && p.project !== project) continue;
      for (const [name, c] of Object.entries(p.services)) {
        const id = `${p.project}/${name}`;
        if (!known.has(id)) list.push({ id, project: p.project, name, state: 'stopped', port: c.port, restarts: 0 });
      }
    }
    const now = Date.now();
    await Promise.all(list.map(async s => {
      if (!s.pid) return;
      let m = this.metrics.get(s.id);
      if (!m || now - m.at > 2000) { m = { at: now, v: await sampleGroup(s.pid) }; this.metrics.set(s.id, m); }
      if (m.v) { s.cpuPercent = m.v.cpuPercent; s.memoryMb = m.v.memoryMb; }
    }));
    return list.sort((a, b) => a.id.localeCompare(b.id));
  }
}
