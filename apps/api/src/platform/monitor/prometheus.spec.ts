import { describe, expect, it, vi } from 'vitest';
import { readPrometheusMonitor } from './prometheus';
import { readMonitorConfig } from './config';

const now = Date.parse('2026-10-18T10:00:00Z');
function fetcher(values: (string | null)[]) {
  return vi.fn<typeof fetch>().mockImplementation(() => {
    const value = values.shift();
    return Promise.resolve(
      new Response(
        JSON.stringify({
          status: 'success',
          data: {
            resultType: 'vector',
            result: value === null ? [] : [{ value: [now / 1000, value] }],
          },
        }),
        { status: 200 },
      ),
    );
  });
}
describe('平台监控固定指标查询', () => {
  it('未配置不发请求，也不宣称Worker正常', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(await readPrometheusMonitor({ timeoutMs: 100 }, now, fetch)).toEqual(
      {
        worker: { status: 'unconfigured' },
        http: { status: 'unconfigured', windowSeconds: 300 },
      },
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('聚合API请求，区分Worker最后采样时间', async () => {
    const fetch = fetcher([
      String(now / 1000 - 10),
      '120',
      '2',
      '0.1',
      '0.05',
      '0.2',
    ]);
    const result = await readPrometheusMonitor(
      { prometheusUrl: 'http://metrics.internal', timeoutMs: 100 },
      now,
      fetch,
    );
    expect(result.worker).toEqual({
      status: 'ready',
      lastSeenAt: '2026-10-18T09:59:50.000Z',
    });
    expect(result.http).toEqual({
      status: 'ready',
      windowSeconds: 300,
      samples: 120,
      requestsPerSecond: 2,
      errorRate: 0.05,
      averageDurationMs: 50,
      p95DurationMs: 200,
    });
    expect(fetch.mock.calls).toHaveLength(6);
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toBeInstanceOf(URL);
      expect((url as URL).pathname).toBe('/api/v1/query');
      expect(options?.redirect).toBe('error');
    }
    expect(JSON.stringify(result)).not.toContain('metrics.internal');
  });
  it('过期Worker采样不显示为在线，请求零样本不制造零错误率', async () => {
    const result = await readPrometheusMonitor(
      { prometheusUrl: 'http://metrics.internal', timeoutMs: 100 },
      now,
      fetcher([String(now / 1000 - 91), '0', '0', '0', 'NaN', 'NaN']),
    );
    expect(result.worker.status).toBe('stale');
    expect(result.http).toEqual({
      status: 'no-data',
      windowSeconds: 300,
      samples: 0,
    });
  });
  it('空向量与NaN指标不转换为健康数据', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          data: { resultType: 'vector', result: [] },
        }),
      ),
    );
    const result = await readPrometheusMonitor(
      { prometheusUrl: 'http://metrics.internal', timeoutMs: 100 },
      now,
      async (...args) => (await fetch(...args)).clone(),
    );
    expect(result.worker.status).toBe('no-data');
    expect(result.http.status).toBe('no-data');
  });
  it('监控源失败只返回稳定状态，不泄露诊断', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error('secret-connection-password'));
    const result = await readPrometheusMonitor(
      { prometheusUrl: 'http://metrics.internal', timeoutMs: 100 },
      now,
      fetch,
    );
    expect(result).toEqual({
      worker: { status: 'unavailable' },
      http: { status: 'unavailable', windowSeconds: 300 },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('只接受部署的HTTP查询源，禁止URL内的凭据与查询串', () => {
    expect(
      readMonitorConfig({ MONITOR_PROMETHEUS_URL: '' }).prometheusUrl,
    ).toBeUndefined();
    for (const source of [
      'file:///tmp/metrics',
      'http://user:pass@host/',
      'http://host/?query=anything',
    ]) {
      expect(() =>
        readMonitorConfig({ MONITOR_PROMETHEUS_URL: source }),
      ).toThrow();
    }
  });
});
