import { useEffect, useMemo, useRef, useState } from 'react';
import { filterLines } from '../lib/logs';

export function LogView({ lines, name }: { lines: string[]; name: string }) {
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLPreElement>(null);
  const shown = useMemo(() => filterLines(lines, query, regex), [lines, query, regex]);

  useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown, follow]);
  const onScroll = () => {
    const el = box.current; if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);        // scrolling up pauses auto-follow
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
    a.download = `${name}.log`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input aria-label="Filter logs" placeholder="Filter…" value={query} onChange={e => setQuery(e.target.value)}
          className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1" />
        <label className="flex items-center gap-1"><input type="checkbox" checked={regex} onChange={e => setRegex(e.target.checked)} /> regex</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> follow</label>
        <button className="rounded border px-2 py-1" onClick={download}>Download</button>
        <span className="text-xs text-gray-500">{shown.length}/{lines.length} lines</span>
      </div>
      <pre ref={box} onScroll={onScroll} data-testid="log-box"
        className="min-h-[16rem] flex-1 overflow-auto rounded bg-gray-950 p-3 text-xs leading-5 text-gray-100">
        {shown.map((l, i) => <div key={i}>{l}</div>)}
      </pre>
    </div>
  );
}
