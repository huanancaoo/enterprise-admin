import { execFileSync } from "node:child_process"

if (process.argv.length !== 2)
  throw new Error("Usage: node infra/release/build-base-images.mjs")
// 配方固定官方源、工具链与修复依赖；不接受替换基础镜像或源码的运行参数。
// OCI attestation 时间戳会改变缓存构建身份；源码/配方校验和 SBOM 在发行 manifest 中绑定。
for (const [target, image, dockerfile] of [
  [
    "postgres",
    "enterprise-admin-postgres:18.6-security-2",
    "Dockerfile.database",
  ],
  ["redis", "enterprise-admin-redis:7.4.5-security-2", "Dockerfile.database"],
  [
    "mailpit",
    "enterprise-admin-mailpit:1.30.4-security-1",
    "Dockerfile.telemetry",
  ],
  [
    "otel-collector",
    "enterprise-admin-otel-collector:0.162.0-security-1",
    "Dockerfile.telemetry",
  ],
  [
    "prometheus",
    "enterprise-admin-prometheus:3.15.0-security-1",
    "Dockerfile.telemetry",
  ],
  [
    "tracing",
    "enterprise-admin-tracing:2.22.0-security-1",
    "Dockerfile.telemetry",
  ],
])
  execFileSync(
    "docker",
    [
      "build",
      "--provenance=false",
      "-f",
      `infra/release/base/${dockerfile}`,
      "--target",
      target,
      "-t",
      image,
      ".",
    ],
    { stdio: "inherit" }
  )
console.log(
  "PASS fixed source base images built; actual image IDs are captured by release acceptance"
)
