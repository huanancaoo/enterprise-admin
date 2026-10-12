import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// 发行包的同一 Compose 已绑定实际镜像 ID；规则验证不重建或依赖本机其他版本的 promtool。
const image = readFileSync(resolve("compose.release.yaml"), "utf8").match(
  /^  prometheus:\n    image: (\S+)/m
)[1]
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
