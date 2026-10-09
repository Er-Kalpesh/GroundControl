import type { ServiceState } from '../types';

export const stateDot: Record<ServiceState, string> = {
  ready: 'bg-green-500', running: 'bg-blue-500', starting: 'bg-blue-400', unhealthy: 'bg-amber-500',
  crashed: 'bg-red-500', stopping: 'bg-gray-400', stopped: 'bg-gray-400',
};
export const isLive = (s: ServiceState) => ['starting', 'running', 'ready', 'unhealthy'].includes(s);

export function uptime(startedAt: number | undefined, now = Date.now()): string {
  if (startedAt === undefined) return '–';
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}
