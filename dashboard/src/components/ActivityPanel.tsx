import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AuditEntry } from '../types';

const badge = { human: 'bg-blue-100 text-blue-800', ai: 'bg-purple-100 text-purple-800', system: 'bg-gray-200 text-gray-800' } as const;

export function ActivityPanel({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  useEffect(() => { api.audit(50).then(r => setRows([...r].reverse())).catch(() => setRows([])); }, [refreshKey]);
  if (!rows.length) return <p className="text-sm text-gray-500">No activity yet.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((e, i) => (
        <li key={i} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">{new Date(e.ts).toLocaleTimeString()}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${badge[e.actor.kind]}`}>{e.actor.kind}:{e.actor.name}</span>
          <span>{e.action}</span><span className="text-gray-500">{e.target}</span>
        </li>
      ))}
    </ul>
  );
}
