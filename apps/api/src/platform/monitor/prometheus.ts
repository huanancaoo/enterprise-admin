import { z } from 'zod';
import type { PlatformMonitor } from '@workspace/contracts';
import type { MonitorConfig } from './config';

const responseSchema = z.object({
  status: z.literal('success'),
  data: z.object({
    resultType: z.literal('vector'),
    result: z.array(z.object({ value: z.tuple([z.number(), z.string()]) })),
  }),
});
const count =
  'http_server_request_duration_seconds_count{service_name="enterprise-admin-api"}';
const sum =
  'http_server_request_duration_seconds_sum{service_name="enterprise-admin-api"}';
const queries = {
  worker:
    'max(timestamp(app_process_uptime_seconds{service_name="enterprise-admin-worker"}))',
  samples: `sum(increase(${count}[5m]))`,
  rate: `sum(rate(${count}[5m]))`,
  errors:
    'sum(rate(http_server_request_duration_seconds_count{service_name="enterprise-admin-api",http_response_status_code=~"5.."}[5m]))',
  average: `sum(rate(${sum}[5m])) / sum(rate(${count}[5m]))`,
  p95: 'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{service_name="enterprise-admin-api"}[5m])))',
} as const;

export async function readPrometheusMonitor(
  config: MonitorConfig,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<Pick<PlatformMonitor, 'worker' | 'http'>> {
  if (!config.prometheusUrl)
    return {
      worker: { status: 'unconfigured' },
      http: { status: 'unconfigured', windowSeconds: 300 },
    };
  try {
    // 查询集合由代码固定；浏览器不能借监控权限访问任意URL或提交PromQL。
    const values = await Promise.all(
      Object.entries(queries).map(async ([key, query]) => {
        const url = new URL(
          `${config.prometheusUrl!.replace(/\/$/, '')}/api/v1/query`,
        );
        url.searchParams.set('query', query);
        const response = await fetcher(url, {
          signal: AbortSignal.timeout(config.timeoutMs),
          redirect: 'error',
        });
        if (!response.ok) throw new Error('MONITOR_UNAVAILABLE');
        const result = responseSchema.parse(await response.json()).data.result;
        const value =
          result.length === 1 ? Number(result[0].value[1]) : undefined;
        return [
          key,
          value !== undefined && Number.isFinite(value) && value >= 0
            ? value
            : undefined,
        ] as const;
      }),
    );
    const result = Object.fromEntries(values);
    const lastSeen = result.worker;
    const worker: PlatformMonitor['worker'] =
      lastSeen === undefined
        ? { status: 'no-data' }
        : {
            status: now - lastSeen * 1000 > 90000 ? 'stale' : 'ready',
            lastSeenAt: new Date(lastSeen * 1000).toISOString(),
          };
    if (result.samples === undefined || result.samples === 0 || !result.rate)
      return {
        worker,
        http: {
          status: 'no-data',
          windowSeconds: 300,
          samples: result.samples,
        },
      };
    // 无5xx序列代表这批已有请求没有5xx；没有请求样本则始终显示无数据。
    return {
      worker,
      http: {
        status: 'ready',
        windowSeconds: 300,
        samples: result.samples,
        requestsPerSecond: result.rate,
        errorRate: Math.min(1, (result.errors ?? 0) / result.rate),
        averageDurationMs:
          result.average === undefined ? undefined : result.average * 1000,
        p95DurationMs: result.p95 === undefined ? undefined : result.p95 * 1000,
      },
    };
  } catch {
    return {
      worker: { status: 'unavailable' },
      http: { status: 'unavailable', windowSeconds: 300 },
    };
  }
}
