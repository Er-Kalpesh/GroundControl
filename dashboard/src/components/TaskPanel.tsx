import { useState } from 'react';
import { api } from '../api';
import type { TaskResult } from '../types';

export function TaskPanel({ project, tasks }: { project: string; tasks: string[] }) {
  const [running, setRunning] = useState<string | null>(null);
  const [cmd, setCmd] = useState('');
  const [result, setResult] = useState<{ label: string; r?: TaskResult; error?: string } | null>(null);

  async function run(label: string, arg: { task?: string; command?: string }) {
    setRunning(label); setResult(null);
    try { setResult({ label, r: await api.runTask(project, arg) }); }
    catch (e) { setResult({ label, error: (e as Error).message }); }
    finally { setRunning(null); }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tasks.length === 0 && <p className="text-sm text-gray-500">No tasks declared in groundcontrol.json.</p>}
        {tasks.map(t => (
          <button key={t} disabled={!!running} onClick={() => run(t, { task: t })} className="rounded border px-3 py-1 text-sm disabled:opacity-40">{running === t ? `Running ${t}…` : t}</button>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (cmd.trim()) void run(cmd, { command: cmd }); }}>
        <input aria-label="Command" placeholder="Run any command (you are a human, so this is allowed)…" value={cmd} onChange={e => setCmd(e.target.value)}
          className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1 font-mono text-sm" />
        <button type="submit" disabled={!!running} className="rounded border px-3 py-1 text-sm disabled:opacity-40">Run</button>
      </form>
      {result?.error && <p role="alert" className="text-sm text-red-600">{result.error}</p>}
      {result?.r && (
        <div className="text-sm">
          <p className={result.r.exitCode === 0 ? 'text-green-600' : 'text-red-600'}>
            {result.label}: exit {result.r.exitCode ?? 'null'} in {result.r.durationMs} ms{result.r.timedOut ? ' (timed out)' : ''}{result.r.truncated ? ' (output truncated)' : ''}
          </p>
          <pre className="mt-1 max-h-96 overflow-auto rounded bg-gray-950 p-3 text-xs text-gray-100">{result.r.stdout}{result.r.stderr}</pre>
        </div>
      )}
    </div>
  );
}
