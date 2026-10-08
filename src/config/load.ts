import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { z } from 'zod';
import { ConfigSchema } from './schema.js';

export class ConfigError extends Error {}

type Parsed = z.infer<typeof ConfigSchema>;
export type ServiceConfig = Parsed['services'][string] & { cwd: string };
export type TaskConfig = Parsed['tasks'][string] & { cwd: string };
export interface ProjectConfig {
  project: string;
  root: string;
  file: string;
  services: Record<string, ServiceConfig>;
  tasks: Record<string, TaskConfig>;
  policy: Parsed['policy'];
}

export function parseConfig(raw: unknown, file: string): ProjectConfig {
  const r = ConfigSchema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new ConfigError(`${file}: ${msg}`);
  }
  const root = dirname(file);
  const services = Object.fromEntries(
    Object.entries(r.data.services).map(([k, v]) => [k, { ...v, cwd: resolve(root, v.cwd ?? '.') }]));
  const tasks = Object.fromEntries(
    Object.entries(r.data.tasks).map(([k, v]) => [k, { ...v, cwd: resolve(root, v.cwd ?? '.') }]));
  return { project: r.data.project, root, file, services, tasks, policy: r.data.policy };
}

export function loadConfig(file: string): ProjectConfig {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { throw new ConfigError(`${file}: cannot read config: ${(e as Error).message}`); }
  return parseConfig(raw, file);
}

export function findConfig(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const f = join(dir, 'groundcontrol.json');
    if (existsSync(f)) return f;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Topological start order (dependencies first). Throws ConfigError on unknown deps or cycles. */
export function startOrder(cfg: ProjectConfig): string[] {
  const out: string[] = [];
  const mark = new Map<string, 1 | 2>();
  const visit = (n: string, chain: string[]) => {
    if (!cfg.services[n]) throw new ConfigError(`unknown dependency "${n}" (needed by ${chain.at(-1)})`);
    if (mark.get(n) === 2) return;
    if (mark.get(n) === 1) throw new ConfigError(`dependency cycle: ${[...chain, n].join(' -> ')}`);
    mark.set(n, 1);
    for (const d of cfg.services[n]!.dependsOn) visit(d, [...chain, n]);
    mark.set(n, 2);
    out.push(n);
  };
  for (const n of Object.keys(cfg.services)) visit(n, []);
  return out;
}
