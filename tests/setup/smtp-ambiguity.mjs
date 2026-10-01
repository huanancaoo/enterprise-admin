import { createServer } from "node:net"

export async function startSmtpAmbiguityServer() {
  const sockets = new Set()
  let dataTerminations = 0
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.write("220 smtp.test ESMTP\r\n")
    let buffer = ""
    let data = false
    socket.on("data", (chunk) => {
      buffer += chunk.toString()
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n")
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (data) {
          if (line === ".") {
            // 已读完邮件却不返回最终确认，使生产适配器无法确定 SMTP 是否接受。
            dataTerminations++
            socket.destroy()
          }
          continue
        }
        if (line.startsWith("EHLO")) socket.write("250 smtp.test\r\n")
        else if (line === "DATA") {
          data = true
          socket.write("354 continue\r\n")
        } else socket.write("250 OK\r\n")
      }
    })
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return {
    smtp: { host: "127.0.0.1", port: server.address().port, secure: false },
    get dataTerminations() {
      return dataTerminations
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
