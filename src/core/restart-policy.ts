export type RestartPolicy = 'never' | 'on-failure' | 'always';

/** Decide whether to auto-restart after an exit. Delay doubles each attempt, capped at 30 s. */
export function nextRestart(
  policy: RestartPolicy, attempt: number, maxRetries: number, backoffMs: number,
  expected: boolean, exitCode: number | null,
): { restart: boolean; delayMs: number } {
  const no = { restart: false, delayMs: 0 };
  if (expected || policy === 'never' || attempt >= maxRetries) return no;
  if (policy === 'on-failure' && exitCode === 0) return no;
  return { restart: true, delayMs: Math.min(backoffMs * 2 ** attempt, 30_000) };
}
