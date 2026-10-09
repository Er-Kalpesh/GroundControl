import { spawn } from 'node:child_process';
import type { TaskResult } from '../types.js';

/** Run one blocking command. Never rejects for a non-zero exit. Keeps the LAST maxOutputBytes of each stream. */
export function runTask(
  command: string,
  o: { cwd: string; timeoutMs: number; maxOutputBytes?: number; env?: Record<string, string> },
): Promise<TaskResult> {
  const max = o.maxOutputBytes ?? 200_000;
  const t0 = Date.now();
  return new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: o.cwd, env: { ...process.env, ...o.env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '', truncated = false, timedOut = false, settled = false;
    const cap = (s: string) => { if (s.length > max) { truncated = true; return s.slice(-max); } return s; };
    child.stdout.on('data', d => { out = cap(out + d); });
    child.stderr.on('data', d => { err = cap(err + d); });
    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ exitCode, signal, stdout: out, stderr: err, truncated, timedOut, durationMs: Date.now() - t0 });
    };
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } }, o.timeoutMs);
    child.on('error', e => { err += String(e); finish(null, null); });
    child.on('close', (code, signal) => finish(code, signal));
  });
}
