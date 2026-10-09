export type ServiceState = 'stopped' | 'starting' | 'running' | 'ready' | 'unhealthy' | 'crashed' | 'stopping';

export interface Service {
  id: string; project: string; name: string; state: ServiceState;
  pid?: number; port?: number; startedAt?: number; restarts: number;
  cpuPercent?: number; memoryMb?: number; lastError?: string; exitCode?: number | null;
}
export interface ProjectInfo { project: string; root: string; file: string; services: string[]; tasks: string[] }
export interface TaskResult {
  exitCode: number | null; signal: string | null; stdout: string; stderr: string;
  truncated: boolean; timedOut: boolean; durationMs: number;
}
export interface AuditEntry { ts: string; actor: { kind: 'human' | 'ai' | 'system'; name: string }; action: string; target: string; detail?: unknown }
export interface Conflict { id: string; port: number; owner: { pid: number; command: string } | null }
