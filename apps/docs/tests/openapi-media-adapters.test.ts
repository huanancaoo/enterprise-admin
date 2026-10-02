import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, test, vi } from "vitest"
import { createBrowserFetcher } from "fumadocs-openapi/playground"
import { createOpenAPI } from "fumadocs-openapi/server"
import { encodeRequestData } from "fumadocs-openapi/requests"
import { createCodeUsageGeneratorRegistry } from "fumadocs-openapi/requests/generators"
import { registerDefault } from "fumadocs-openapi/requests/generators/all"
import {
  binaryCodeUsages,
  imageMediaAdapters,
  imagePlaygroundFetchOptions,
} from "../lib/openapi-media-adapters"

const images = [
  ["image/jpeg", "image.jpg"],
  ["image/png", "image.png"],
  ["image/webp", "image.webp"],
  ["image/gif", "image.gif"],
] as const
const bytes = new Uint8Array([0, 255, 128, 65, 10])
const operationId = "13d3bd04-8148-4c56-9d22-7c13457194e1"
const url = "https://api.example.test/api/v1/personal-media?example=true"

function requestData(bodyMediaType: string, body: unknown) {
  return encodeRequestData(
    {
      method: "post",
      bodyMediaType,
      body,
      path: {},
      query: {},
      header: { "Idempotency-Key": operationId },
      cookie: { session: "example-session" },
    },
    imageMediaAdapters
  )
}

const generatorContext = {
  mediaAdapters: imageMediaAdapters,
  custom: undefined,
}
afterEach(() => vi.unstubAllGlobals())

test("image adapters match the actual raw binary OpenAPI declaration", async () => {
  const document = JSON.parse(
    await readFile(
      new URL("../../api/openapi/openapi.json", import.meta.url),
      "utf8"
    )
  )
  const content =
    document.paths["/api/v1/personal-media"].post.requestBody.content
  assert.deepEqual(
    Object.keys(imageMediaAdapters).sort(),
    Object.keys(content).sort()
  )
  for (const media of Object.values(content)) {
    assert.deepEqual(media, { schema: { type: "string", format: "binary" } })
  }
})

for (const [mediaType, fileName] of images) {
  test(`public browser fetcher sends ${mediaType} File bytes unchanged`, async () => {
    vi.stubGlobal("document", {
      baseURI: "https://docs.example.test/",
      cookie: "",
    })
    let sent: Request | undefined
    vi.stubGlobal("fetch", async (input: URL, init: RequestInit) => {
      sent = new Request(input, init)
      return new Response("ok")
    })
    const file = new File([bytes], fileName, { type: mediaType })
    assert.equal(imageMediaAdapters[mediaType]!.encode({ body: file }), file)
    const result = await createBrowserFetcher(imageMediaAdapters, {
      requestTimeout: false,
    }).fetch(url, requestData(mediaType, file))
    assert.equal(result.type, "response")
    assert.ok(sent)
    assert.equal(sent.url, url)
    assert.equal(sent.method, "POST")
    assert.equal(sent.headers.get("Content-Type"), mediaType)
    assert.equal(sent.headers.get("Idempotency-Key"), operationId)
    assert.deepEqual(new Uint8Array(await sent.arrayBuffer()), bytes)
  })
}

test("binary adapters preserve empty Blob and reject textual or object conversions", () => {
  const adapter = imageMediaAdapters["image/png"]!
  const empty = new Blob([], { type: "image/png" })
  assert.equal(adapter.encode({ body: empty }), empty)
  for (const body of ["image.png", { file: "image.png" }]) {
    assert.throws(() => adapter.encode({ body }), /File or Blob/)
  }
})

test("generated binary requests preserve method, URL, headers, cookies and corresponding file format", () => {
  for (const [mediaType, fileName] of images) {
    const data = { ...requestData(mediaType, new File([bytes], fileName)), url }
    for (const [id, generator] of binaryCodeUsages.map()) {
      const example = generator.generate(data, generatorContext)
      assert.ok(example.includes(url), id)
      assert.ok(example.includes(operationId), id)
      assert.ok(example.includes("example-session"), id)
      assert.ok(example.includes(mediaType), id)
      assert.ok(example.includes(fileName), id)
      assert.doesNotMatch(example, /\[object (?:Object|File|Blob)\]/)
      if (id === "curl") {
        assert.ok(example.includes(`--data-binary @${fileName}`))
        assert.doesNotMatch(example, /(?:^|\s)-[dF]\s/)
      }
      if (id === "go") {
        assert.match(example, /http\.NewRequest\("POST"/)
        assert.match(example, /requestBody, err := os\.Open/)
        assert.match(example, /responseBody, err := io\.ReadAll/)
      }
    }
  }
})

test("generated JavaScript executes a raw file upload without stringifying the body", async () => {
  const directory = await mkdtemp(join(tmpdir(), "docs-binary-example-"))
  try {
    await writeFile(join(directory, "image.png"), bytes)
    const example = binaryCodeUsages
      .get("js")!
      .generate(
        { ...requestData("image/png", new File([bytes], "image.png")), url },
        generatorContext
      )
    await writeFile(
      join(directory, "example.mjs"),
      `globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        process.stdout.write(JSON.stringify({
          method: request.method,
          url: request.url,
          headers: Object.fromEntries(request.headers),
          bytes: Array.from(new Uint8Array(await request.arrayBuffer()))
        }));
        return new Response("ok");
      };\n${example}`
    )
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["example.mjs"],
      {
        cwd: directory,
      }
    )
    const sent = JSON.parse(stdout)
    assert.equal(sent.method, "POST")
    assert.equal(sent.url, url)
    assert.equal(sent.headers["content-type"], "image/png")
    assert.equal(sent.headers["idempotency-key"], operationId)
    assert.equal(sent.headers.cookie, "session=example-session")
    assert.deepEqual(sent.bytes, Array.from(bytes))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("generated cURL sends a raw file body with URL, headers and cookies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "docs-binary-curl-"))
  let resolveRequest!: (value: {
    method: string | undefined
    url: string | undefined
    headers: Record<string, string | string[] | undefined>
    bytes: number[]
  }) => void
  const received = new Promise<Parameters<typeof resolveRequest>[0]>(
    (resolve) => {
      resolveRequest = resolve
    }
  )
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    resolveRequest({
      method: request.method,
      url: request.url,
      headers: request.headers,
      bytes: Array.from(Buffer.concat(chunks)),
    })
    response.end("ok")
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert.ok(address && typeof address === "object")
    await writeFile(join(directory, "image.webp"), bytes)
    const requestUrl = `http://127.0.0.1:${address.port}/binary?example=true`
    const example = binaryCodeUsages
      .get("curl")!
      .generate(
        { ...requestData("image/webp", "string"), url: requestUrl },
        generatorContext
      )
    await promisify(execFile)("sh", ["-c", example], { cwd: directory })
    const sent = await received
    assert.equal(sent.method, "POST")
    assert.equal(sent.url, "/binary?example=true")
    assert.equal(sent.headers["content-type"], "image/webp")
    assert.equal(sent.headers["idempotency-key"], operationId)
    assert.equal(sent.headers.cookie, "session=example-session")
    assert.deepEqual(sent.bytes, Array.from(bytes))
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
    await rm(directory, { recursive: true, force: true })
  }
})

test("non-image languages and media retain the official generators", () => {
  const defaults = registerDefault(createCodeUsageGeneratorRegistry())
  for (const mediaType of [
    "application/json",
    "application/octet-stream",
    "multipart/form-data",
  ]) {
    const data = { ...requestData(mediaType, { name: "example" }), url }
    for (const [id, generator] of defaults.map()) {
      assert.equal(
        binaryCodeUsages.get(id)!.generate(data, generatorContext),
        generator.generate(data, generatorContext),
        `${id}: ${mediaType}`
      )
    }
  }
  for (const id of ["js", "python", "java", "csharp", "rust"]) {
    assert.equal(binaryCodeUsages.get(id), defaults.get(id))
  }
})

for (const [mediaType, fileName] of images) {
  test(`formal loaded Playground default sends selected ${mediaType} File type and bytes`, async () => {
    const sourceDocument = JSON.parse(
      await readFile(
        new URL("../../api/openapi/openapi.json", import.meta.url),
        "utf8"
      )
    )
    const openapi = createOpenAPI({
      input: { formal: sourceDocument },
      disableCache: true,
    })
    const { bundled } = await openapi.getSchema("formal")
    const document = bundled as typeof sourceDocument
    const operation = document.paths["/api/v1/personal-media"].post
    const defaultMediaType = Object.keys(operation.requestBody.content)[0]!
    assert.equal(defaultMediaType, "image/jpeg")
    assert.ok(Object.hasOwn(operation.requestBody.content, mediaType))
    vi.stubGlobal("document", {
      baseURI: "https://docs.example.test/",
      cookie: "",
    })
    let sent: Request | undefined
    vi.stubGlobal("fetch", async (input: URL, init: RequestInit) => {
      sent = new Request(input, init)
      return new Response("ok")
    })
    const file = new File([bytes], fileName, { type: mediaType })
    await createBrowserFetcher(imageMediaAdapters, {
      ...imagePlaygroundFetchOptions,
      requestTimeout: false,
    }).fetch(url, requestData(defaultMediaType, file))
    assert.ok(sent)
    assert.equal(sent.headers.get("Content-Type"), mediaType)
    assert.equal(sent.headers.get("Idempotency-Key"), operationId)
    assert.deepEqual(new Uint8Array(await sent.arrayBuffer()), bytes)
  })
}

test("image request hook rejects an undeclared File type without converting to JPEG", async () => {
  vi.stubGlobal("document", {
    baseURI: "https://docs.example.test/",
    cookie: "",
  })
  const fetch = vi.fn()
  vi.stubGlobal("fetch", fetch)
  await assert.rejects(
    createBrowserFetcher(imageMediaAdapters, imagePlaygroundFetchOptions).fetch(
      url,
      requestData(
        "image/jpeg",
        new File([bytes], "image.svg", { type: "image/svg+xml" })
      )
    ),
    /JPEG, PNG, WebP or GIF/
  )
  assert.equal(fetch.mock.calls.length, 0)
})

test("image hook replaces header case-insensitively and retains body and all other request facts", async () => {
  const file = new File([bytes], "image.png", { type: "image/png" })
  const input = {
    body: file,
    headers: {
      "content-type": "image/jpeg",
      "Idempotency-Key": operationId,
      Cookie: "session=example-session",
    },
    method: "POST",
    credentials: "include" as const,
  }
  const result = await imagePlaygroundFetchOptions.onRequestInit!(input)
  assert.equal(result.body, file)
  assert.equal(result.method, input.method)
  assert.equal(result.credentials, input.credentials)
  const headers = new Headers(result.headers)
  assert.equal(headers.get("Content-Type"), "image/png")
  assert.equal(headers.get("Idempotency-Key"), operationId)
  assert.equal(headers.get("Cookie"), "session=example-session")
})

test("image hook preserves non-image raw, JSON and multipart requests", async () => {
  for (const mediaType of [
    "application/octet-stream",
    "application/json",
    "multipart/form-data",
  ]) {
    const input = {
      body: new File([bytes], "image.png", { type: "image/png" }),
      headers: { "Content-Type": mediaType },
    }
    assert.equal(await imagePlaygroundFetchOptions.onRequestInit!(input), input)
  }
})
