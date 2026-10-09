import type { ServiceStatus } from '../types.js';

/** Plain padded table, no dependencies. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
  return [line(headers), line(widths.map(w => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

export function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d${Math.floor((s % 86400) / 3600)}h`;
}

export function statusTable(list: ServiceStatus[], now = Date.now()): string {
  if (!list.length) return 'no services';
  return table(
    ['SERVICE', 'STATE', 'PID', 'PORT', 'CPU%', 'MEM(MB)', 'UPTIME', 'RESTARTS'],
    list.map(s => [
      s.id, s.state, s.pid ? String(s.pid) : '-', s.port ? String(s.port) : '-',
      s.cpuPercent !== undefined ? String(s.cpuPercent) : '-', s.memoryMb !== undefined ? String(s.memoryMb) : '-',
      s.startedAt && s.pid ? fmtUptime(now - s.startedAt) : '-', String(s.restarts),
    ]));
}
