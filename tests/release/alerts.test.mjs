import { execFileSync } from "node:child_process"
import { beforeAll, expect, test } from "vitest"

beforeAll(() =>
  execFileSync(
    "docker",
    [
      "build",
      "--provenance=false",
      "-f",
      "infra/release/base/Dockerfile.telemetry",
      "--target",
      "prometheus",
      "-t",
      "enterprise-admin-prometheus:3.15.0-security-1",
      ".",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  )
)

test("本地告警规则识别服务缺失、任务积压与执行失败，并保持正常流量静默", () => {
  const output = execFileSync(
    process.execPath,
    ["infra/observability/check-alerts.mjs"],
    { encoding: "utf8", timeout: 180_000 }
  )
  expect(output).toContain("SUCCESS")
})
