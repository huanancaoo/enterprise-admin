import { createServer, createConnection } from "node:net"

export async function redisResponseGate(host, port) {
  let blocked = false
  let target
  const sockets = new Set()
  const pending = []
  const server = createServer((client) => {
    const upstream = createConnection({ host, port })
    sockets.add(client)
    sockets.add(upstream)
    client.on("error", () => upstream.destroy())
    upstream.on("error", () => client.destroy())
    client.on("close", () => {
      sockets.delete(client)
      upstream.destroy()
    })
    upstream.on("close", () => {
      sockets.delete(upstream)
      client.destroy()
    })
    client.pipe(upstream)
    let buffer = Buffer.alloc(0)
    upstream.on("data", (bytes) => {
      buffer = Buffer.concat([buffer, bytes])
      let length
      while ((length = frameLength(buffer)) !== undefined) {
        const frame = buffer.subarray(0, length)
        buffer = buffer.subarray(length)
        // 请求始终到达真实 Redis；仅暂缓响应，以复现入队完成但调用方结果未知。
        if (target && frame.includes(Buffer.from(target))) blocked = true
        if (blocked) pending.push({ client, bytes: frame })
        else client.write(frame)
      }
    })
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return {
    url: `redis://127.0.0.1:${server.address().port}`,
    block(jobId) {
      target = jobId
    },
    release() {
      blocked = false
      target = undefined
      for (const { client, bytes } of pending.splice(0))
        if (!client.destroyed) client.write(bytes)
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

// TCP 分包不等于 Redis 响应边界；完整解析 RESP 帧后才丢弃特定 Job ID 的成功确认。
function frameLength(bytes, offset = 0) {
  if (offset >= bytes.length) return undefined
  const end = bytes.indexOf("\r\n", offset)
  if (end === -1) return undefined
  const kind = String.fromCharCode(bytes[offset]),
    count = Number(bytes.toString("ascii", offset + 1, end))
  let next = end + 2
  if (kind === "$" && count >= 0) next += count + 2
  if (kind === "*" && count >= 0) {
    for (let i = 0; i < count; i++) {
      const child = frameLength(bytes, next)
      if (child === undefined) return undefined
      next += child
    }
  }
  return next <= bytes.length ? next - offset : undefined
}
