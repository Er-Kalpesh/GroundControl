import type { ServiceStatus, TaskResult } from '../types.js';
import { statusTable } from '../cli/format.js';

export const MAX_TEXT = 20_000;

/** Hard cap on any text returned to an AI: keep the END (errors are at the end) and say what was cut. */
export function capText(text: string, max = MAX_TEXT): string {
  if (text.length <= max) return text;
  return `[truncated ${text.length - max} chars from the start]\n${text.slice(-max)}`;
}

/** Accept {id:"proj/name"} or {project, name}; project may be filled in by the caller's default. */
export function resolveId(a: { id?: string; project?: string; name?: string }, defaultProject?: string): string {
  if (a.id) {
    if (a.id.includes('/')) return a.id;
    if (defaultProject) return `${defaultProject}/${a.id}`;
    throw new Error(`"${a.id}" is not a full id; use "project/service" or pass project`);
  }
  const project = a.project ?? defaultProject;
  if (!project || !a.name) throw new Error('provide id ("project/service") or project + name');
  return `${project}/${a.name}`;
}

export const formatStatus = (list: ServiceStatus[]) => statusTable(list);

export function formatTask(r: TaskResult): string {
  const head = `exit=${r.exitCode ?? 'null'}${r.signal ? ` signal=${r.signal}` : ''} duration=${r.durationMs}ms`
    + `${r.timedOut ? ' TIMED OUT' : ''}${r.truncated ? ' (output truncated to the last part)' : ''}`;
  return capText(`${head}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
}

export function formatLogs(lines: string[], nextOffset: number): string {
  return capText(`${lines.join('\n')}\n[nextOffset=${nextOffset} — pass since=${nextOffset} to read only newer output]`);
}
