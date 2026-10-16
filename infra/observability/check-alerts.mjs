import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

// 发行包的同一 Compose 已绑定实际镜像 ID；规则验证不重建或依赖本机其他版本的 promtool。
// 使用 Compose 自身解析且不展开部署变量，离线发行目录无需安装 Node 依赖。
const compose = JSON.parse(
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      resolve("compose.release.yaml"),
      "config",
      "--no-interpolate",
      "--format",
      "json",
    ],
    { encoding: "utf8" }
  )
)
const image = compose.services.prometheus.image
const output = execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "--entrypoint",
    "promtool",
    "--volume",
    `${resolve("infra/observability")}:/rules:ro`,
    "--workdir",
    "/rules",
    image,
    "test",
    "rules",
    "alerts.test.yaml",
  ],
  { encoding: "utf8" }
)
process.stdout.write(output)
