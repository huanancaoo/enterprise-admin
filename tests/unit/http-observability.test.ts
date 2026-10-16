import { createServer } from "node:http"
import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { expect, test } from "vitest"
import {
  beginHttpRequest,
  initializeTelemetry,
  shutdownTelemetry,
} from "../../packages/observability/src/index"

type Attribute = {
  key: string
  value: { stringValue?: string; intValue?: string }
}
type ExportedSpan = {
  attributes: Attribute[]
  status: { code: number }
}
type TraceExport = {
  resourceSpans?: { scopeSpans: { spans: ExportedSpan[] }[] }[]
}

test("HTTP terminal outcomes end real spans with fixed, exported error classifications", async () => {
  const exported: TraceExport[] = []
  const receiver = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    if (request.url === "/v1/traces") {
      exported.push(JSON.parse(Buffer.concat(chunks).toString()) as TraceExport)
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
    await shutdownTelemetry()

    const spans = exported.flatMap((batch) =>
      (batch.resourceSpans ?? []).flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans)
      )
    )
    const observations = spans.map((span) => ({
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
