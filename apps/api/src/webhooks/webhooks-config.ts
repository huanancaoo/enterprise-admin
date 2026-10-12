import type { WorkerConfig } from '@workspace/jobs';
export type WebhooksConfig = {
  worker: WorkerConfig;
  timeoutMs: number;
  pollIntervalMs: number;
};
export const webhooksConfig = Symbol('webhooksConfig');
