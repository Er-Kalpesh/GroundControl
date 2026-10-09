export const MAX_LINES = 2000;

/** Append keeping only the newest `cap` lines. Returns a new array. */
export function appendCapped(lines: string[], line: string, cap = MAX_LINES): string[] {
  const next = lines.length >= cap ? lines.slice(lines.length - cap + 1) : lines.slice();
  next.push(line);
  return next;
}

/** Case-insensitive substring filter, or a regex when `regex` is true. An invalid regex matches nothing. */
export function filterLines(lines: string[], query: string, regex: boolean): string[] {
  if (!query) return lines;
  if (!regex) { const q = query.toLowerCase(); return lines.filter(l => l.toLowerCase().includes(q)); }
  try { const re = new RegExp(query, 'i'); return lines.filter(l => re.test(l)); } catch { return []; }
}
