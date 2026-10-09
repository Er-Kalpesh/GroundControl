import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServiceRow } from './components/ServiceRow';
import { LogView } from './components/LogView';
import { appendCapped, filterLines, MAX_LINES } from './lib/logs';
import { uptime, stateDot } from './lib/state';
import type { Service } from './types';

const svc = (over: Partial<Service> = {}): Service => ({ id: 'p/web', project: 'p', name: 'web', state: 'ready', restarts: 0, port: 5173, pid: 1, startedAt: Date.now() - 65_000, cpuPercent: 1.5, memoryMb: 40, ...over });
const noop = () => {};
const row = (s: Service, extra = {}) => render(<ul><ServiceRow service={s} selected={false} onSelect={noop} onStart={noop} onStop={noop} onRestart={noop} onKillAndStart={noop} {...extra} /></ul>);

describe('ServiceRow', () => {
  it.each(['ready', 'crashed', 'stopped', 'unhealthy'] as const)('colours the dot for %s', state => {
    row(svc({ state }));
    expect(screen.getByTestId('state-dot').className).toContain(stateDot[state]);
  });
  it('shows port link, cpu, memory and uptime for a live service', () => {
    row(svc());
    expect(screen.getByRole('link', { name: ':5173' })).toHaveAttribute('href', 'http://localhost:5173');
    expect(screen.getByText('40 MB')).toBeInTheDocument(); expect(screen.getByText(/up 1m/)).toBeInTheDocument();
  });
  it('enables Start only when stopped, Stop only when live', () => {
    const { unmount } = row(svc({ state: 'stopped', pid: undefined }));
    expect(screen.getByText('Start')).toBeEnabled(); expect(screen.getByText('Stop')).toBeDisabled(); unmount();
    row(svc());
    expect(screen.getByText('Start')).toBeDisabled(); expect(screen.getByText('Stop')).toBeEnabled();
  });
  it('shows the kill button only when there is a port conflict, and calls back', () => {
    const { unmount } = row(svc({ state: 'stopped' }));
    expect(screen.queryByText('Kill process and start')).toBeNull(); unmount();
    const onKill = vi.fn();
    row(svc({ state: 'stopped' }), { conflict: { id: 'p/web', port: 5173, owner: { pid: 99, command: 'node' } }, onKillAndStart: onKill });
    expect(screen.getByRole('alert')).toHaveTextContent('Port 5173 is in use by node (pid 99)');
    fireEvent.click(screen.getByText('Kill process and start')); expect(onKill).toHaveBeenCalledOnce();
  });
  it('shows the last error', () => { row(svc({ state: 'crashed', lastError: 'exited with 1' })); expect(screen.getByText('exited with 1')).toBeInTheDocument(); });
});

describe('log helpers', () => {
  it('appendCapped keeps the newest lines only', () => {
    expect(appendCapped(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
    let l: string[] = []; for (let i = 0; i < MAX_LINES + 50; i++) l = appendCapped(l, String(i));
    expect(l).toHaveLength(MAX_LINES); expect(l.at(-1)).toBe(String(MAX_LINES + 49));
  });
  it('filterLines supports substring, regex and invalid regex', () => {
    const l = ['GET /a 200', 'GET /b 500', 'boot'];
    expect(filterLines(l, '', false)).toEqual(l);
    expect(filterLines(l, 'get', false)).toEqual(['GET /a 200', 'GET /b 500']);
    expect(filterLines(l, ' 5\\d\\d$', true)).toEqual(['GET /b 500']);
    expect(filterLines(l, '(', true)).toEqual([]);
  });
  it('uptime formats', () => { expect(uptime(undefined)).toBe('–'); expect(uptime(0, 5000)).toBe('5s'); expect(uptime(0, 3_700_000)).toBe('1h 1m'); });
});

describe('LogView', () => {
  it('hides non-matching lines when filtering and reports counts', () => {
    render(<LogView name="web" lines={['alpha', 'beta', 'alphabet']} />);
    expect(screen.getAllByText(/alpha|beta/)).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'alpha' } });
    expect(screen.queryByText('beta')).toBeNull(); expect(screen.getByText('2/3 lines')).toBeInTheDocument();
  });
});
