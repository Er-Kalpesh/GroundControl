import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Build a starter groundcontrol.json by looking at what is in `dir`. Pure apart from reading files. */
export function detectConfig(dir: string): Record<string, unknown> {
  const has = (f: string) => existsSync(join(dir, f));
  const services: Record<string, unknown> = {};
  const tasks: Record<string, unknown> = {};

  if (has('docker-compose.yml') || has('docker-compose.yaml') || has('compose.yml') || has('compose.yaml')) {
    services.docker = { command: 'docker compose up', stopCommand: 'docker compose stop' };
  }
  if (has('artisan')) {
    services.api = {
      command: 'php artisan serve --port=8000', port: 8000,
      health: { type: 'tcp', port: 8000 },
      restart: { policy: 'on-failure', maxRetries: 3 },
      ...(services.docker ? { dependsOn: ['docker'] } : {}),
    };
    tasks.migrate = { command: 'php artisan migrate --force', timeoutMs: 120000 };
    tasks.test = { command: 'php artisan test' };
  }
  if (has('package.json')) {
    let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { /* unreadable: ignore */ }
    const scripts = pkg.scripts ?? {};
    const isVite = !!(pkg.dependencies?.vite ?? pkg.devDependencies?.vite);
    const run = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
    if (run) {
      services.web = {
        command: `npm run ${run}`, ...(isVite ? { port: 5173, health: { type: 'tcp', port: 5173 } } : {}),
        ...(services.api ? { dependsOn: ['api'] } : {}),
      };
    }
    for (const [k, v] of Object.entries(scripts)) {
      if (['build', 'test', 'lint'].includes(k)) tasks[k] = { command: `npm run ${k}` };
    }
    if (scripts.build) tasks.build = { command: 'npm run build' };
    if (scripts.test && !tasks.test) tasks.test = { command: 'npm test' };
  }

  const project = basename(dir).replace(/[^A-Za-z0-9._-]/g, '-') || 'project';
  return { version: 1, project, services, tasks, policy: { allowArbitraryTasks: false } };
}
