import { openSync, closeSync, statSync, readSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * File-backed log. Child processes write straight into the file (we hand them `fd()`),
 * so the daemon is never in the data path and logs survive daemon restarts.
 * The store tails the file to keep the last N lines in memory and to notify subscribers.
 */
export class LogStore {
  private fdNum: number | null = null;
  private readPos = 0;
  private partial = '';
  private mem: string[] = [];
  private subs = new Set<(line: string) => void>();
  private timer: NodeJS.Timeout | null = null;
  private readonly memoryLines: number;
  private readonly maxFileBytes: number;

  constructor(private file: string, opts: { memoryLines?: number; maxFileBytes?: number } = {}) {
    this.memoryLines = opts.memoryLines ?? 1000;
    this.maxFileBytes = opts.maxFileBytes ?? 5 * 1024 * 1024;
    mkdirSync(dirname(file), { recursive: true });
  }

  /** Append-mode fd to hand to child_process.spawn as stdout/stderr. */
  fd(): number {
    if (this.fdNum === null) this.fdNum = openSync(this.file, 'a');
    return this.fdNum;
  }

  /** Begin tailing. Idempotent. Loads up to the last 256 KiB of an existing file into memory. */
  start() {
    if (this.timer) return;
    this.fd();
    this.readPos = Math.max(0, this.size() - 256 * 1024);
    this.drain();
    // Plain polling: fs.watchFile misses writes that happen before its first baseline stat.
    this.timer = setInterval(() => this.drain(), 100);
    this.timer.unref();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; this.drain(); }
    if (this.fdNum !== null) { closeSync(this.fdNum); this.fdNum = null; }
  }

  size(): number {
    try { return statSync(this.file).size; } catch { return 0; }
  }

  private drain() {
    const size = this.size();
    if (size < this.readPos) { this.readPos = 0; this.partial = ''; }   // rotated or truncated
    if (size === this.readPos) return;
    let fd: number;
    try { fd = openSync(this.file, 'r'); } catch { return; }
    try {
      const buf = Buffer.alloc(size - this.readPos);
      readSync(fd, buf, 0, buf.length, this.readPos);
      this.readPos = size;
      const parts = (this.partial + buf.toString('utf8')).split('\n');
      this.partial = parts.pop() ?? '';
      for (const line of parts) {
        this.mem.push(line);
        if (this.mem.length > this.memoryLines) this.mem.shift();
        for (const s of this.subs) s(line);
      }
    } finally { closeSync(fd); }
  }

  /** Last n complete lines (from memory). */
  tail(n: number): string[] { return this.mem.slice(-n); }

  /** Complete lines written after byte `offset`; returns the next offset to pass back in. */
  since(offset: number): { lines: string[]; offset: number } {
    const size = this.size();
    if (offset >= size) return { lines: [], offset: size };
    const fd = openSync(this.file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(size - offset, 1024 * 1024));
      readSync(fd, buf, 0, buf.length, offset);
      const text = buf.toString('utf8');
      const end = text.lastIndexOf('\n') + 1;                       // only complete lines
      const lines = text.slice(0, end).split('\n').slice(0, -1);
      return { lines, offset: offset + Buffer.byteLength(text.slice(0, end)) };
    } finally { closeSync(fd); }
  }

  subscribe(fn: (line: string) => void): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }

  /**
   * Move an oversized file to `<file>.1`. ONLY call this while no child is writing
   * (ProcessManager calls it right before a start): a running child keeps its old fd
   * and would keep writing into the rotated file.
   */
  rotate() {
    if (!existsSync(this.file) || this.size() <= this.maxFileBytes) return;
    this.drain();
    if (this.fdNum !== null) { closeSync(this.fdNum); this.fdNum = null; }
    renameSync(this.file, this.file + '.1');
    this.readPos = 0; this.partial = '';
    this.fd();
  }
}
