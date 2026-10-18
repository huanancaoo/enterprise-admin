import { createServer } from "node:http"
import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { expect, test, vi } from "vitest"
import {
  beginHttpRequest,
  initializeTelemetry,
  shutdownTelemetry,
} from "../../packages/observability/src/index"

type Attribute = {
  key: string
  value: { stringValue?: string; intValue?: string | number }
}
type ExportedSpan = {
  attributes: Attribute[]
  status: { code: number }
}
type TraceExport = {
  resourceSpans?: { scopeSpans: { spans: ExportedSpan[] }[] }[]
}
type HistogramPoint = {
  attributes: Attribute[]
  count: string
  sum: number
  explicitBounds: number[]
  bucketCounts: string[]
}
type MetricExport = {
  resourceMetrics?: {
    scopeMetrics: {
      metrics: {
        name: string
        unit: string
        histogram?: { dataPoints: HistogramPoint[] }
      }[]
    }[]
  }[]
}

test("HTTP exports fixed error classifications and second-scale duration buckets", async () => {
  const exported: TraceExport[] = []
  const exportedMetrics: MetricExport[] = []
  const receiver = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    if (request.url === "/v1/traces") {
      exported.push(JSON.parse(Buffer.concat(chunks).toString()) as TraceExport)
    }
    if (request.url === "/v1/metrics") {
      exportedMetrics.push(
        JSON.parse(Buffer.concat(chunks).toString()) as MetricExport
      )
    }
    response.writeHead(200, { "content-type": "application/json" }).end("{}")
  })
  const listening = once(receiver, "listening")
  receiver.listen(0, "127.0.0.1")
  await listening
  const previousEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  const address = receiver.address() as AddressInfo
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${address.port}`
  try {
    initializeTelemetry("http-observation-test")
    beginHttpRequest("completed-request", "GET").finish(
      200,
      "/files/:fileId",
      "completed"
    )
    beginHttpRequest("aborted-request", "GET").finish(
      undefined,
      "/files/:fileId",
      "aborted"
    )
    beginHttpRequest("error-request", "GET").finish(
      200,
      "/files/:fileId",
      "error"
    )
    beginHttpRequest("server-error-request", "GET").finish(
      503,
      "/files/:fileId",
      "completed"
    )
    // 只控制请求计时，导出和 SDK 聚合仍走真实实现。
    let clock = 0
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock)
    try {
      for (let index = 0; index < 20; index += 1) {
        const request = beginHttpRequest(`duration-${index}`, "GET")
        clock += 64
        request.finish(200, "/duration-check", "completed")
      }
    } finally {
      now.mockRestore()
    }
    await shutdownTelemetry()

    const durationMetrics = exportedMetrics.flatMap((batch) =>
      (batch.resourceMetrics ?? []).flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) =>
          scope.metrics.filter(
            (metric) => metric.name === "http.server.request.duration"
          )
        )
      )
    )
    expect(durationMetrics).toHaveLength(1)
    const durationMetric = durationMetrics[0]!
    expect(durationMetric.unit).toBe("s")
    const duration = durationMetric.histogram!.dataPoints.find((point) =>
      point.attributes.some(
        ({ key, value }) =>
          key === "http.route" && value.stringValue === "/duration-check"
      )
    )!
    expect(Number(duration.count)).toBe(20)
    expect(duration.sum).toBeCloseTo(1.28)
    expect(duration.explicitBounds).toEqual([
      0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
    ])
    expect(duration.bucketCounts.map(Number)).toEqual([
      0, 0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
    expect(duration.attributes).toEqual(
      expect.arrayContaining([
        { key: "http.request.method", value: { stringValue: "GET" } },
        { key: "http.route", value: { stringValue: "/duration-check" } },
        { key: "http.response.status_code", value: { intValue: 200 } },
      ])
    )
    expect(duration.attributes).toHaveLength(3)

    // Prometheus 会把 OTLP 的区间计数转成累计桶，再对 5 分钟 rate 做线性插值。
    // 20 个 64 ms 请求应落在 50–75 ms 桶，不能再次得到默认桶的 4.75 秒。
    const bucketRates = duration.bucketCounts.map(
      (_, index, counts) =>
        counts
          .slice(0, index + 1)
          .reduce((sum, count) => sum + Number(count), 0) / 300
    )
    const rank = (0.95 * Number(duration.count)) / 300
    const bucketIndex = bucketRates.findIndex((rate) => rate >= rank)
    const lowerBound = duration.explicitBounds[bucketIndex - 1]!
    const upperBound = duration.explicitBounds[bucketIndex]!
    const lowerRate = bucketRates[bucketIndex - 1]!
    const upperRate = bucketRates[bucketIndex]!
    const p95 =
      lowerBound +
      ((rank - lowerRate) / (upperRate - lowerRate)) * (upperBound - lowerBound)
    expect(p95).toBeCloseTo(0.07375)
    expect(duration.sum / Number(duration.count)).toBeCloseTo(0.064)

    const spans = exported.flatMap((batch) =>
      (batch.resourceSpans ?? []).flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans)
      )
    )
    const observations = spans
      .filter((span) =>
        span.attributes.some(
          ({ key, value }) =>
            key === "http.route" && value.stringValue === "/files/:fileId"
        )
      )
      .map((span) => ({
        status: span.status.code,
        attributes: Object.fromEntries(
          span.attributes.map(({ key, value }) => [
            key,
            value.stringValue ?? Number(value.intValue),
          ])
        ),
      }))
    expect(observations).toHaveLength(4)
    expect(observations).toEqual(
      expect.arrayContaining([
        {
          status: 0,
          attributes: {
            "request.id": "completed-request",
            "http.request.method": "GET",
            "http.route": "/files/:fileId",
            "http.response.status_code": 200,
          },
        },
        {
          status: 2,
          attributes: {
            "request.id": "aborted-request",
            "http.request.method": "GET",
            "http.route": "/files/:fileId",
            "error.type": "http.response.aborted",
          },
        },
        {
          status: 2,
          attributes: {
            "request.id": "error-request",
            "http.request.method": "GET",
            "http.route": "/files/:fileId",
            "http.response.status_code": 200,
            "error.type": "http.response.error",
          },
        },
        {
          status: 2,
          attributes: {
            "request.id": "server-error-request",
            "http.request.method": "GET",
            "http.route": "/files/:fileId",
            "http.response.status_code": 503,
            "error.type": "503",
          },
        },
      ])
    )
  } finally {
    if (previousEndpoint === undefined)
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previousEndpoint
    receiver.closeAllConnections()
    await new Promise<void>((resolve) => receiver.close(() => resolve()))
  }
})
