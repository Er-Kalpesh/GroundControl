import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, bootstrap } from './api';
import { useEventStream, useLogStream } from './hooks';
import { ServiceRow } from './components/ServiceRow';
import { LogView } from './components/LogView';
import { TaskPanel } from './components/TaskPanel';
import { ActivityPanel } from './components/ActivityPanel';
import type { Conflict, ProjectInfo, Service } from './types';

type Tab = 'logs' | 'tasks' | 'activity';
const SNIPPET = `{
  "version": 1,
  "project": "my-app",
  "services": { "web": { "command": "npm run dev", "port": 5173 } }
}`;

export default function App() {
  const [auth, setAuth] = useState<'loading' | 'ok' | 'need-token'>('loading');
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [project, setProject] = useState<string>('');
  const [services, setServices] = useState<Service[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('logs');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activityKey, setActivityKey] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const ps = await api.projects(); setProjects(ps);
      setProject(cur => cur || ps[0]?.project || '');
      setServices(await api.services());
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { bootstrap().then(r => { setAuth(r); if (r === 'ok') void refresh(); }).catch(e => setError(String(e))); }, [refresh]);
  useEffect(() => { if (auth !== 'ok') return; const t = setInterval(() => void api.services().then(setServices).catch(() => {}), 5000); return () => clearInterval(t); }, [auth]);

  const connected = useEventStream(
    useCallback((s: Service) => { setServices(prev => prev.map(x => (x.id === s.id ? { ...x, ...s } : x))); setActivityKey(k => k + 1); }, []),
    useCallback(() => { if (auth === 'ok') void refresh(); }, [auth, refresh]),
  );

  const mine = useMemo(() => services.filter(s => s.project === project), [services, project]);
  const current = mine.find(s => s.id === selected) ?? mine[0];
  const lines = useLogStream(tab === 'logs' && current ? current.id : null);
  const info = projects.find(p => p.project === project);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id); setError(null); setConflict(null);
    try { await fn(); await refresh(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.port) setConflict({ id, port: e.body.port, owner: e.body.owner });
      else setError((e as Error).message);
    } finally { setBusy(null); }
  }

  if (auth === 'loading') return <p className="p-6">Loading…</p>;
  if (auth === 'need-token') return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-semibold">GroundControl</h1>
      <p className="mt-2">This page needs your API token. Run <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">groundcontrol ui</code> in a terminal to open the dashboard with it.</p>
    </main>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h1 className="text-lg font-semibold">GroundControl</h1>
        <select aria-label="Project" value={project} onChange={e => { setProject(e.target.value); setSelected(null); }} className="rounded border bg-transparent px-2 py-1 text-sm">
          {projects.map(p => <option key={p.project} value={p.project}>{p.project}</option>)}
        </select>
        <button disabled={!project || !!busy} onClick={() => act(project, () => api.up(project))} className="rounded border px-3 py-1 text-sm disabled:opacity-40">Start all</button>
        <button disabled={!project || !!busy} onClick={() => act(project, () => api.down(project))} className="rounded border px-3 py-1 text-sm disabled:opacity-40">Stop all</button>
        <span className="ml-auto flex items-center gap-1 text-xs text-gray-500">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />{connected ? 'live' : 'reconnecting…'}
        </span>
      </header>

      {error && <p role="alert" className="border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      {projects.length === 0 ? (
        <main className="mx-auto max-w-xl p-6">
          <p>No project registered yet. In your project folder run <code>groundcontrol init</code> and <code>groundcontrol start</code>, or create this file:</p>
          <pre className="mt-3 overflow-auto rounded bg-gray-950 p-3 text-xs text-gray-100">{SNIPPET}</pre>
        </main>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-[22rem_minmax(0,1fr)]">
          <ul className="space-y-3 md:max-h-[calc(100vh-6rem)] md:overflow-auto">
            {mine.map(s => (
              <ServiceRow key={s.id} service={s} selected={current?.id === s.id} busy={busy === s.id}
                conflict={conflict?.id === s.id ? conflict : null}
                onSelect={() => setSelected(s.id)}
                onStart={() => act(s.id, () => api.start(s.id))} onStop={() => act(s.id, () => api.stop(s.id))}
                onRestart={() => act(s.id, () => api.restart(s.id))} onKillAndStart={() => act(s.id, () => api.start(s.id, true))} />
            ))}
          </ul>
          <section className="flex min-h-0 flex-col gap-3">
            <nav className="flex gap-2 border-b border-gray-200 dark:border-gray-800">
              {(['logs', 'tasks', 'activity'] as Tab[]).map(t => (
                <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm capitalize ${tab === t ? 'border-b-2 border-blue-500 font-medium' : 'text-gray-500'}`}>{t}</button>
              ))}
            </nav>
            {tab === 'logs' && (current ? <LogView lines={lines} name={current.name} /> : <p className="text-sm text-gray-500">Select a service.</p>)}
            {tab === 'tasks' && <TaskPanel project={project} tasks={info?.tasks ?? []} />}
            {tab === 'activity' && <ActivityPanel refreshKey={activityKey} />}
          </section>
        </div>
      )}
    </div>
  );
}
