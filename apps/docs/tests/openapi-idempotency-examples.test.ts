import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { test } from "vitest"
import {
  OperationProvider,
  useCodeUsage,
  useExampleRequests,
  type ExampleRequest,
  type PageOperationProps,
} from "fumadocs-openapi/operation"
import { createOpenAPIPage } from "fumadocs-openapi/ui"
import {
  binaryCodeUsages,
  imageMediaAdapters,
} from "../lib/openapi-media-adapters"

const document = JSON.parse(
  await readFile(
    new URL("../../api/openapi/openapi.json", import.meta.url),
    "utf8"
  )
)
const operations = [
  ["/api/v1/personal-media", "post", "uploadPersonalMedia"],
  [
    "/api/v1/platform/organizations/{organizationId}/storage-policy",
    "patch",
    "updatePlatformStoragePolicy",
  ],
  [
    "/api/v1/platform/organizations/{organizationId}/suspend",
    "post",
    "suspendPlatformOrganization",
  ],
  [
    "/api/v1/platform/organizations/{organizationId}/resume",
    "post",
    "resumePlatformOrganization",
  ],
  ["/api/v1/platform/settings", "patch", "updatePlatformSettings"],
] as const

for (const [path, method, operationId] of operations) {
  test(`official ${operationId} page generates one valid idempotency header`, () => {
    let captured:
      | {
          example: ExampleRequest | undefined
          javascript: string | undefined
          curl: string | undefined
        }
      | undefined

    function ExampleProbe() {
      captured = {
        example: useExampleRequests().items[0],
        javascript: useCodeUsage("js"),
        curl: useCodeUsage("curl"),
      }
      return null
    }

    function OperationProbe(props: PageOperationProps) {
      return createElement(OperationProvider, {
        ...props,
        children: createElement(ExampleProbe),
      })
    }

    // Exercise the page's real sample generation; a hand-built header map hides duplicate Swagger parameters.
    const Page = createOpenAPIPage({
      mediaAdapters: imageMediaAdapters,
      codeUsages: binaryCodeUsages,
      components: { Operation: OperationProbe },
    })
    renderToStaticMarkup(
      createElement(Page, {
        payload: { bundled: document },
        operations: [{ path, method }],
      })
    )

    assert.ok(captured?.example)
    const { example, javascript, curl } = captured
    const operation = document.paths[path][method]
    assert.equal(operation.operationId, operationId)
    const headers = operation.parameters.filter(
      (parameter: { in: string; name: string }) => parameter.in === "header"
    )
    assert.equal(headers.length, 1)
    assert.equal(headers[0].name, "idempotency-key")
    assert.equal(headers[0].required, true)
    assert.deepEqual(Object.keys(example.encoded.header), ["idempotency-key"])
    const key = example.encoded.header["idempotency-key"]!.value
    const encodedHeaders = new Headers(
      Object.fromEntries(
        Object.entries(example.encoded.header).map(([name, parameter]) => [
          name,
          parameter.value,
        ])
      )
    )
    assert.equal(encodedHeaders.get("idempotency-key"), key)
    assert.ok(!key.includes(","))
    if (operationId === "uploadPersonalMedia") {
      assert.deepEqual(headers[0].schema, { type: "string", format: "uuid" })
      assert.match(
        key,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    } else if (operationId === "updatePlatformSettings") {
      assert.deepEqual(headers[0].schema, { type: "string", maxLength: 128 })
    } else {
      assert.deepEqual(headers[0].schema, {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^[A-Za-z0-9:_-]+$",
      })
    }
    assert.ok(javascript)
    assert.ok(curl)
    assert.equal((javascript.match(/"idempotency-key"/gi) ?? []).length, 1)
    assert.equal((curl.match(/idempotency-key:/gi) ?? []).length, 1)
    assert.ok(javascript.includes(JSON.stringify(key)))
    assert.ok(curl.includes(`idempotency-key: ${key}`))
  })
}
