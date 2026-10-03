import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { GenericContainer } from "testcontainers"
import { expect, test } from "vitest"
import { containerHostURL } from "../setup/container-host.mjs"

test("Linux 容器无需 Docker Desktop 宿主机别名即可访问测试进程的回环端口", async () => {
  const resources = new AsyncDisposableStack()
  try {
    const token = randomUUID()
    const server = createServer((request, response) =>
      response.end(token + request.url)
    )
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    resources.defer(() => new Promise((resolve) => server.close(resolve)))
    const url = await containerHostURL(
      `http://127.0.0.1:${server.address().port}/probe?token=${token}`
    )
    const versions = JSON.parse(
      await readFile("docs/architecture/versions.json", "utf8")
    )
    const container = await new GenericContainer(versions.nodeImage)
      // 让桌面专用别名指向容器自己，确保验收不依赖开发机隐式提供的宿主机解析。
      .withExtraHosts([
        { host: "host.docker.internal", ipAddress: "127.0.0.1" },
      ])
      .withCommand(["sleep", "infinity"])
      .start()
    resources.defer(() => container.stop())
    const result = await container.exec([
      "node",
      "-e",
      "fetch(process.argv[1],{signal:AbortSignal.timeout(5000)}).then(async response=>console.log(await response.text())).catch(error=>{console.error(error.cause?.code??error.message);process.exitCode=1})",
      url,
    ])
    expect(result.exitCode, result.output).toBe(0)
    expect(result.output.trim()).toBe(`${token}/probe?token=${token}`)
  } finally {
    await resources.disposeAsync()
  }
})
