import { useEffect, useRef, useState } from 'react';
import type { Service } from './types';
import { appendCapped } from './lib/logs';

/** Live service state via SSE. EventSource reconnects by itself; on every (re)open we refetch the full list. */
export function useEventStream(onState: (s: Service) => void, onOpen: () => void) {
  const [connected, setConnected] = useState(false);
  const cb = useRef({ onState, onOpen });
  cb.current = { onState, onOpen };
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => { setConnected(true); cb.current.onOpen(); };
    es.onerror = () => setConnected(false);
    es.onmessage = e => { try { cb.current.onState(JSON.parse(e.data) as Service); } catch { /* ignore malformed frame */ } };
    return () => es.close();
  }, []);
  return connected;
}

/** Live log lines of one service (server replays the last 200 on connect, then streams). */
export function useLogStream(id: string | null) {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    setLines([]);
    if (!id) return;
    const es = new EventSource(`/api/services/${id}/logs/stream`);
    es.onmessage = e => { try { const { line } = JSON.parse(e.data) as { line: string }; setLines(prev => appendCapped(prev, line)); } catch { /* ignore */ } };
    return () => es.close();
  }, [id]);
  return lines;
}
