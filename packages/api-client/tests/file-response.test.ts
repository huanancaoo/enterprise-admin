import { createServer, type RequestListener, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import {
  ApiClientError,
  apiClient,
  configureApiClient,
  getFileVersionContent,
  getPersonalMediaContent,
  uploadPersonalMedia,
} from "../src/index"

type FileResponse = { data: Blob; status: number; headers: Headers }

const servers: Server[] = []

const forbidden = {
  code: "FORBIDDEN",
  message: "文件访问被拒绝",
  requestId: "sdk-file-request",
  locale: "zh-CN",
}

async function setup(handler: RequestListener) {
  const server = createServer((request, response) => {
    if (request.headers.cookie !== "session=sdk-file-test") {
      response.writeHead(403, { "Content-Type": "application/json" })
      response.end(JSON.stringify(forbidden))
      return
    }
    handler(request, response)
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  configureApiClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    getHeaders: () => ({ Cookie: "session=sdk-file-test" }),
  })
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

describe("受保护文件响应", () => {
  it("正式个人媒体内容操作按 Blob 读取并传递明确的组织范围", async () => {
    const source = Uint8Array.from([0x00, 0xff, 0x80, 0x0a])
    let requestedUrl: string | undefined
    await setup((request, response) => {
      requestedUrl = request.url
      response.writeHead(200, { "Content-Type": "image/png" })
      response.end(source)
    })
    const result = await getPersonalMediaContent(
      "a5e6d781-c0c6-4516-9823-3d9dbf6a0202",
      { organizationId: "de07383d-3c46-4a6c-9f3e-fd9c9191bc61" }
    )
    expect(result.data).toBeInstanceOf(Blob)
    expect(new Uint8Array(await result.data.arrayBuffer())).toEqual(source)
    expect(requestedUrl).toBe(
      "/api/v1/personal-media/a5e6d781-c0c6-4516-9823-3d9dbf6a0202/content?organizationId=de07383d-3c46-4a6c-9f3e-fd9c9191bc61"
    )
  })

  it("正式个人媒体上传保留原始 Blob、实际 MIME 和幂等身份", async () => {
    const source = Uint8Array.from([0x00, 0xff, 0x80, 0x0a])
    let receivedBody: Buffer | undefined
    let receivedType: string | undefined
    let receivedKey: string | string[] | undefined
    const id = "a5e6d781-c0c6-4516-9823-3d9dbf6a0202"
    await setup(async (request, response) => {
      receivedType = request.headers["content-type"]
      receivedKey = request.headers["idempotency-key"]
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk)
      receivedBody = Buffer.concat(chunks)
      response.writeHead(201, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ result: "accepted" }))
    })
    const result = await uploadPersonalMedia(
      new Blob([source], { type: "image/png" }),
      { "Idempotency-Key": id },
      { headers: { "Content-Type": "image/png" } }
    )
    expect(result.status).toBe(201)
    expect(receivedType).toBe("image/png")
    expect(receivedKey).toBe(id)
    expect(receivedBody).toEqual(Buffer.from(source))
  })

  it.each(["application/json", "text/plain"])(
    "正式生成内容操作默认按Blob读取%s并传递Range和预览参数",
    async (contentType) => {
      const source = Uint8Array.from([0x20, 0xff, 0x80, 0x0a])
      let requestedUrl: string | undefined
      let requestedRange: string | undefined
      await setup((request, response) => {
        requestedUrl = request.url
        requestedRange = request.headers.range
        response.writeHead(206, {
          "Content-Type": contentType,
          "Content-Length": source.length,
          "Content-Range": "bytes 0-3/8",
        })
        response.end(source)
      })
      const result = await getFileVersionContent(
        "de07383d-3c46-4a6c-9f3e-fd9c9191bc61",
        "04054822-25f5-4c6a-9854-63d1d01574b7",
        "a5e6d781-c0c6-4516-9823-3d9dbf6a0202",
        { disposition: "inline" },
        { Range: "bytes=0-3" }
      )
      expect(result.status).toBe(206)
      expect(result.data).toBeInstanceOf(Blob)
      expect(new Uint8Array(await result.data.arrayBuffer())).toEqual(source)
      expect(result.headers.get("content-range")).toBe("bytes 0-3/8")
      expect(requestedUrl).toBe(
        "/api/v1/organizations/de07383d-3c46-4a6c-9f3e-fd9c9191bc61/files/entries/04054822-25f5-4c6a-9854-63d1d01574b7/versions/a5e6d781-c0c6-4516-9823-3d9dbf6a0202/content?disposition=inline"
      )
      expect(requestedRange).toBe("bytes=0-3")
    }
  )
  it("显式 Blob 读取保留原始二进制字节、状态与下载头", async () => {
    await setup((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="data.bin"',
      })
      response.end(Uint8Array.from([0x00, 0x41, 0xff, 0x80, 0x0a]))
    })

    const result = await apiClient<FileResponse>(
      "/api/v1/files/version/content",
      {
        responseType: "blob",
      }
    )

    expect(result.data).toBeInstanceOf(Blob)
    expect(new Uint8Array(await result.data.arrayBuffer())).toEqual(
      Uint8Array.from([0x00, 0x41, 0xff, 0x80, 0x0a])
    )
    expect(result.status).toBe(200)
    expect(result.headers.get("content-disposition")).toBe(
      'attachment; filename="data.bin"'
    )
  })
  it.each(["application/json; charset=utf-8", "text/plain; charset=utf-8"])(
    "Blob 读取 %s 文件时保留格式和原始字节",
    async (contentType) => {
      await setup((_request, response) => {
        response.writeHead(200, { "Content-Type": contentType })
        response.end(
          Uint8Array.from([
            0x20, 0x7b, 0x22, 0x78, 0x22, 0x3a, 0x31, 0x7d, 0x0a,
          ])
        )
      })

      const result = await apiClient<FileResponse>(
        "/api/v1/files/version/content",
        {
          responseType: "blob",
        }
      )

      expect(result.data).toBeInstanceOf(Blob)
      expect(new Uint8Array(await result.data.arrayBuffer())).toEqual(
        Uint8Array.from([0x20, 0x7b, 0x22, 0x78, 0x22, 0x3a, 0x31, 0x7d, 0x0a])
      )
    }
  )

  it("真实 206 分段响应保留所选字节与 Range、Disposition 头", async () => {
    let receivedRange: string | undefined
    await setup((request, response) => {
      receivedRange = request.headers.range
      response.writeHead(206, {
        "Content-Type": "application/octet-stream",
        "Content-Length": "3",
        "Content-Range": "bytes 2-4/6",
        "Accept-Ranges": "bytes",
        "Content-Disposition": 'inline; filename="partial.bin"',
      })
      response.end(Uint8Array.from([0xff, 0x80, 0x41]))
    })

    const result = await apiClient<FileResponse>(
      "/api/v1/files/version/content",
      {
        responseType: "blob",
        headers: { Range: "bytes=2-4" },
      }
    )

    expect(receivedRange).toBe("bytes=2-4")
    expect(result.status).toBe(206)
    expect(new Uint8Array(await result.data.arrayBuffer())).toEqual(
      Uint8Array.from([0xff, 0x80, 0x41])
    )
    expect(result.headers.get("content-range")).toBe("bytes 2-4/6")
    expect(result.headers.get("accept-ranges")).toBe("bytes")
    expect(result.headers.get("content-disposition")).toBe(
      'inline; filename="partial.bin"'
    )
  })

  it("零字节文件仍返回成功的空 Blob", async () => {
    await setup((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": "0",
      })
      response.end()
    })

    const result = await apiClient<FileResponse>(
      "/api/v1/files/version/content",
      {
        responseType: "blob",
      }
    )

    expect(result.status).toBe(200)
    expect(result.data).toBeInstanceOf(Blob)
    expect(result.data.size).toBe(0)
  })

  it.each([undefined, "blob"] as const)(
    "204 在 responseType=%s 时仍保留无内容语义",
    async (responseType) => {
      await setup((_request, response) => {
        response.writeHead(204)
        response.end()
      })

      const result = await apiClient<{
        data: undefined
        status: number
        headers: Headers
      }>("/api/v1/files/version/content", { responseType })

      expect(result.status).toBe(204)
      expect(result.data).toBeUndefined()
      expect(result.headers).toBeInstanceOf(Headers)
    }
  )

  it.each([
    ["application/json", '{"id":"accepted"}', { id: "accepted" }],
    ["text/plain", "accepted", "accepted"],
  ] as const)(
    "普通 %s 请求保留现有解码行为",
    async (contentType, body, expected) => {
      await setup((_request, response) => {
        response.writeHead(200, { "Content-Type": contentType })
        response.end(body)
      })

      const result = await apiClient<{
        data: unknown
        status: number
        headers: Headers
      }>("/api/v1/projects")

      expect(result.status).toBe(200)
      expect(result.data).toEqual(expected)
    }
  )

  it("文件读取被拒绝时仍以正式 ApiError 抛出", async () => {
    await setup((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/octet-stream" })
      response.end("allowed")
    })

    const rejected = apiClient<FileResponse>("/api/v1/files/version/content", {
      responseType: "blob",
      headers: { Cookie: "session=denied" },
    })

    await expect(rejected).rejects.toBeInstanceOf(ApiClientError)
    await expect(rejected).rejects.toMatchObject({
      status: 403,
      body: forbidden,
    })
  })

  it("响应正文在网络传输中截断时拒绝，不能返回部分文件为成功", async () => {
    await setup((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": "6",
        Connection: "close",
      })
      response.end(Uint8Array.from([0x00, 0x41, 0xff]))
    })

    await expect(
      apiClient<FileResponse>("/api/v1/files/version/content", {
        responseType: "blob",
      })
    ).rejects.toBeInstanceOf(TypeError)
  })

  it("正文未传输完成时 Abort 会拒绝请求", async () => {
    let signalBodySent!: () => void
    const bodySent = new Promise<void>((resolve) => {
      signalBodySent = resolve
    })
    await setup((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": "1024",
      })
      response.write(Uint8Array.from([0x00, 0xff]), signalBodySent)
    })
    const controller = new AbortController()

    const pending = apiClient<FileResponse>("/api/v1/files/version/content", {
      responseType: "blob",
      signal: controller.signal,
    })
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    })
    await bodySent
    controller.abort()

    await rejected
  })
})
