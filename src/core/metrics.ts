import { execFile } from 'node:child_process';

export interface Sample { cpuPercent: number; memoryMb: number }

/** Sum %cpu and RSS (KiB) of every process in process group `pgid`, from `ps -axo pgid=,pcpu=,rss=` output. */
export function parsePs(out: string, pgid: number): Sample | null {
  let cpu = 0, rss = 0, n = 0;
  for (const line of out.split('\n')) {
    const [g, c, r] = line.trim().split(/\s+/).map(Number);
    if (g === pgid && c !== undefined && r !== undefined) { cpu += c; rss += r; n++; }
  }
  return n ? { cpuPercent: Math.round(cpu * 10) / 10, memoryMb: Math.round(rss / 1024) } : null;
}

export const sampleGroup = (pgid: number) => new Promise<Sample | null>(resolve =>
  execFile('ps', ['-axo', 'pgid=,pcpu=,rss='], { maxBuffer: 8 * 1024 * 1024 }, (_e, out) => resolve(parsePs(out ?? '', pgid))));
