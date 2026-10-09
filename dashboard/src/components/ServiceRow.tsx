import type { Conflict, Service } from '../types';
import { isLive, stateDot, uptime } from '../lib/state';

export function ServiceRow(p: {
  service: Service; selected: boolean; conflict?: Conflict | null; busy?: boolean;
  onSelect: () => void; onStart: () => void; onStop: () => void; onRestart: () => void; onKillAndStart: () => void;
}) {
  const s = p.service; const live = isLive(s.state);
  return (
    <li className={`rounded-lg border p-3 ${p.selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-800'}`}>
      <div className="flex items-center gap-3">
        <span data-testid="state-dot" title={s.state} className={`h-2.5 w-2.5 shrink-0 rounded-full ${stateDot[s.state]}`} />
        <button className="min-w-0 flex-1 truncate text-left font-medium" onClick={p.onSelect}>{s.name}</button>
        <span className="text-xs text-gray-500">{s.state}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-gray-500">
        {s.port && <a className="text-blue-600 hover:underline dark:text-blue-400" href={`http://localhost:${s.port}`} target="_blank" rel="noreferrer">:{s.port}</a>}
        {live && <span>{s.cpuPercent ?? 0}% cpu</span>}
        {live && <span>{s.memoryMb ?? 0} MB</span>}
        {live && <span>up {uptime(s.startedAt)}</span>}
        {s.restarts > 0 && <span>{s.restarts} restarts</span>}
      </div>
      {s.lastError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{s.lastError}</p>}
      {p.conflict && (
        <div role="alert" className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
          Port {p.conflict.port} is in use{p.conflict.owner ? ` by ${p.conflict.owner.command} (pid ${p.conflict.owner.pid})` : ''}.
          <button className="ml-2 rounded bg-amber-500 px-2 py-0.5 font-medium text-white" onClick={p.onKillAndStart}>Kill process and start</button>
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <button disabled={p.busy || live} className="rounded border px-2 py-1 text-xs disabled:opacity-40" onClick={p.onStart}>Start</button>
        <button disabled={p.busy || !live} className="rounded border px-2 py-1 text-xs disabled:opacity-40" onClick={p.onStop}>Stop</button>
        <button disabled={p.busy} className="rounded border px-2 py-1 text-xs disabled:opacity-40" onClick={p.onRestart}>Restart</button>
      </div>
    </li>
  );
}
