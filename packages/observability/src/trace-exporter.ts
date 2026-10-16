import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"

type Spans = Parameters<OTLPTraceExporter["export"]>[0]
type Span = Spans[number]

const attributeNames = new Set([
  "http.request.method",
  "http.route",
  "http.response.status_code",
  "request.id",
  "task.type",
  "task.outcome",
  "task.business_outcome",
  "error.code",
  "error.type",
  "exception.type",
  "bullmq.queue.name",
  "bullmq.queue.operation",
  "bullmq.job.name",
  "bullmq.job.id",
  "bullmq.job.attempts.made",
  "bullmq.job.processed.timestamp",
  "bullmq.job.attempt_finished_timestamp",
  "bullmq.job.state",
  "bullmq.job.status",
])

function attributes(values: Span["attributes"]): Span["attributes"] {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => attributeNames.has(key))
  )
}

export class OperationalTraceExporter extends OTLPTraceExporter {
  override export(
    spans: Spans,
    callback: Parameters<OTLPTraceExporter["export"]>[1]
  ): void {
    // SQL/外部服务原始异常及 BullMQ 结果可包含业务内容；只将关联、分类和时序送出进程。
    // 投影发生在导出边界，队列执行收到的原业务错误、重试和持久状态不受影响。
    super.export(
      spans.map((span) => ({
        ...span,
        spanContext: () => span.spanContext(),
        attributes: attributes(span.attributes),
        status: { code: span.status.code },
        events: span.events.map((event) => ({
          ...event,
          attributes: attributes(event.attributes ?? {}),
        })),
        links: span.links.map((link) => ({
          ...link,
          attributes: attributes(link.attributes ?? {}),
        })),
      })),
      callback
    )
  }
}
