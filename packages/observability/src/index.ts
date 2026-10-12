import {
  context,
  metrics,
  trace,
  SpanKind,
  SpanStatusCode,
  type ObservableResult,
} from "@opentelemetry/api"
import { NodeSDK } from "@opentelemetry/sdk-node"
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { OperationalTraceExporter } from "./trace-exporter.ts"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http"
import pino from "pino"

export const operationalLogger = pino({ name: "enterprise-admin" })
let sdk: NodeSDK | undefined

export function initializeTelemetry(serviceName: string): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  // 未配置收集端时仍保留本地操作日志；发行 Compose 显式配置自托管 OTLP 接收端。
  if (sdk || !endpoint) return
  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OperationalTraceExporter({
      url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint.replace(/\/$/, "")}/v1/metrics`,
      }),
      exportIntervalMillis: Number(
        process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 10_000
      ),
    }),
  })
  sdk.start()
  metrics
    .getMeter("enterprise-admin")
    .createObservableGauge("app.process.uptime", { unit: "s" })
    .addCallback((result) => result.observe(process.uptime()))
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown()
}

export function beginHttpRequest(requestId: string, method: string) {
  const started = performance.now()
  const span = trace
    .getTracer("enterprise-admin.http")
    .startSpan(`HTTP ${method}`, {
      kind: SpanKind.SERVER,
      attributes: { "http.request.method": method, "request.id": requestId },
    })
  const active = trace.setSpan(context.active(), span)
  return {
    run<T>(work: () => T): T {
      return context.with(active, work)
    },
    finish(statusCode: number, route: string) {
      const attributes = {
        "http.request.method": method,
        "http.route": route,
        "http.response.status_code": statusCode,
      }
      span.setAttributes(attributes)
      if (statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR })
      metrics
        .getMeter("enterprise-admin.http")
        .createHistogram("http.server.request.duration", { unit: "s" })
        .record((performance.now() - started) / 1000, attributes)
      span.end()
      return {
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
      }
    },
  }
}

export function recordTaskEvent(
  record: Record<string, string | number | undefined>,
  write: (record: Record<string, string | number | undefined>) => void = (
    record
  ) => operationalLogger.info(record)
): void {
  if (record.event === "task_attempt_failed") {
    metrics
      .getMeter("enterprise-admin.tasks")
      .createCounter("task.attempts.failed")
      .add(1, {
        "task.type": String(record.type ?? "invalid"),
        outcome: String(record.outcome),
        code: String(record.code),
      })
  }
  const span = trace.getActiveSpan()
  if (span) {
    span.setAttributes({
      "request.id": record.requestId,
      "task.type": record.type,
      "task.outcome": record.outcome,
      "task.business_outcome": record.businessOutcome,
      "error.code": record.code,
    })
  }
  write({
    ...record,
    ...(span
      ? {
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
        }
      : {}),
  })
}

export function observeQueue(
  readCounts: () => Promise<Record<string, number>>,
  queueName: string
): () => void {
  const depth = metrics
    .getMeter("enterprise-admin.tasks")
    .createObservableGauge("task.queue.depth")
  const observe = async (result: ObservableResult) => {
    const counts = await readCounts()
    for (const [state, count] of Object.entries(counts))
      result.observe(count, { queue: queueName, state })
  }
  depth.addCallback(observe)
  return () => depth.removeCallback(observe)
}
