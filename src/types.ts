export type ServiceState =
  | 'stopped' | 'starting' | 'running' | 'ready' | 'unhealthy' | 'crashed' | 'stopping';

export type Actor = { kind: 'human' | 'ai' | 'system'; name: string };

export interface ServiceStatus {
  id: string;            // "project/service"
  project: string;
  name: string;
  state: ServiceState;
  pid?: number;
  port?: number;
  startedAt?: number;    // epoch ms
  exitCode?: number | null;
  restarts: number;
  cpuPercent?: number;
  memoryMb?: number;
  lastError?: string;
}

export interface TaskResult {
  exitCode: number | null; signal: string | null; stdout: string; stderr: string;
  truncated: boolean; timedOut: boolean; durationMs: number;
}
