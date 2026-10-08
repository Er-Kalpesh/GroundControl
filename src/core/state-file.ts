import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface PersistedService {
  id: string; pid: number; pgid: number; startedAt: number;
  command: string; cwd: string; logFile: string;
}

export class StateFile {
  constructor(private file: string) {}

  load(): Record<string, PersistedService> {
    try { return JSON.parse(readFileSync(this.file, 'utf8')); } catch { return {}; }
  }

  /** Atomic write: temp file in the same directory, then rename. */
  save(all: Record<string, PersistedService>) {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

export function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Process start time in epoch ms (1 s resolution), or null if the process does not exist. Used to reject pid reuse. */
export function processStartTime(pid: number): number | null {
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const t = Date.parse(out.replace(/\s+/g, ' '));
    return Number.isNaN(t) ? null : t;
  } catch { return null; }
}
