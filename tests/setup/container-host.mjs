import { TestContainers } from "testcontainers"

export async function containerHostURL(value) {
  const url = new URL(value)
  // 在启动消费此 URL 的容器前建立转发，Linux CI 与桌面 Docker 使用同一连接路径。
  await TestContainers.exposeHostPorts(Number(url.port))
  url.hostname = "host.testcontainers.internal"
  return url.toString()
}
