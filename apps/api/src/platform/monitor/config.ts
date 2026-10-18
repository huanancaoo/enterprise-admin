import { z } from 'zod';
import { parseEnvironment } from '../../config/environment';

const schema = z.object({
  MONITOR_PROMETHEUS_URL: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    })
    .optional(),
  MONITOR_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(3000),
});
export type MonitorConfig = { prometheusUrl?: string; timeoutMs: number };
export function readMonitorConfig(env: NodeJS.ProcessEnv): MonitorConfig {
  const value = parseEnvironment(schema, {
    ...env,
    MONITOR_PROMETHEUS_URL: env.MONITOR_PROMETHEUS_URL || undefined,
  });
  return {
    prometheusUrl: value.MONITOR_PROMETHEUS_URL,
    timeoutMs: value.MONITOR_TIMEOUT_MS,
  };
}
