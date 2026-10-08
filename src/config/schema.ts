import { z } from 'zod';

export const HealthSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('http'), url: z.string().url(), expectStatus: z.number().int().default(200),
    intervalMs: z.number().int().default(2000), timeoutMs: z.number().int().default(60000),
  }),
  z.object({
    type: z.literal('tcp'), port: z.number().int().min(1).max(65535), host: z.string().default('127.0.0.1'),
    intervalMs: z.number().int().default(1000), timeoutMs: z.number().int().default(60000),
  }),
  z.object({
    type: z.literal('log'), pattern: z.string(), timeoutMs: z.number().int().default(60000),
  }),
]);

export const RestartSchema = z.object({
  policy: z.enum(['never', 'on-failure', 'always']).default('never'),
  maxRetries: z.number().int().min(0).default(3),
  backoffMs: z.number().int().min(10).default(1000),
});

const NAME = /^[A-Za-z0-9._-]+$/;

export const ServiceSchema = z.object({
  command: z.string().min(1),
  stopCommand: z.string().optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).default({}),
  port: z.number().int().min(1).max(65535).optional(),
  dependsOn: z.array(z.string()).default([]),
  health: HealthSchema.optional(),
  restart: RestartSchema.default({}),
  stopTimeoutMs: z.number().int().min(100).default(10000),
  autostart: z.boolean().default(true),
});

export const TaskSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().min(100).default(300000),
});

export const ConfigSchema = z.object({
  version: z.literal(1),
  project: z.string().regex(NAME, 'project must match [A-Za-z0-9._-]+'),
  services: z.record(z.string().regex(NAME, 'service name must match [A-Za-z0-9._-]+'), ServiceSchema),
  tasks: z.record(z.string(), TaskSchema).default({}),
  policy: z.object({ allowArbitraryTasks: z.boolean().default(false) }).default({}),
});
