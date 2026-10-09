import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Actor } from '../types.js';

export interface AuditEntry { ts: string; actor: Actor; action: string; target: string; detail?: object }

/** Append-only JSONL record of who did what (human, which AI, or the system). */
export class AuditLog {
  constructor(private file: string) { mkdirSync(dirname(file), { recursive: true }); }

  record(actor: Actor, action: string, target: string, detail?: Record<string, unknown>) {
    const e: AuditEntry = { ts: new Date().toISOString(), actor, action, target, detail };
    try { appendFileSync(this.file, JSON.stringify(e) + '\n', { mode: 0o600 }); }
    catch (err) { process.stderr.write(`audit write failed: ${String(err)}\n`); }   // never let auditing crash the daemon
  }

  recent(n: number): AuditEntry[] {
    try { return readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean).slice(-n).map(l => JSON.parse(l)); }
    catch { return []; }
  }
}
