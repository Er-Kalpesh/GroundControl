import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const START = '__GC_PATH_START__', END = '__GC_PATH_END__';

/** Extract the PATH printed between our markers, ignoring any noise a shell rc file prints. */
export function parseShellPath(out: string): string | null {
  const a = out.indexOf(START), b = out.indexOf(END);
  if (a < 0 || b < a) return null;
  const p = out.slice(a + START.length, b).trim();
  return p || null;
}

/** Union of PATH lists, first occurrence wins, empty entries dropped. */
export function mergePath(...lists: (string | undefined)[]): string {
  const seen = new Set<string>();
  for (const l of lists) for (const p of (l ?? '').split(':')) if (p) seen.add(p);
  return [...seen].join(':');
}

/**
 * A daemon started by a GUI app (Claude Desktop, launchd) inherits a minimal PATH, so `php`, `npm`,
 * `docker` etc. would not be found. Ask the user's login shell what PATH it would use.
 */
export function resolveUserPath(timeoutMs = 20_000): Promise<string | null> {
  const shell = process.env.SHELL || '/bin/zsh';
  return new Promise(resolve => {
    execFile(shell, ['-ilc', `printf '${START}%s${END}' "$PATH"`],
      { timeout: timeoutMs, env: { ...process.env, TERM: 'dumb' } },
      (_err, stdout) => resolve(parseShellPath(String(stdout ?? ''))));
  });
}

/** Last resolved login-shell PATH, so a daemon start does not wait for slow rc files (nvm, conda, ...). */
export function loadCachedPath(file: string): string | null {
  try { return readFileSync(file, 'utf8').trim() || null; } catch { return null; }
}
export function saveCachedPath(file: string, path: string) {
  try { writeFileSync(file, path, { mode: 0o600 }); } catch { /* cache is best-effort */ }
}
