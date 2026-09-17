import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { GenericContainer, Wait } from "testcontainers"

// 每个探针独享容器；MFA 的上游 Schema 实验不能影响生产认证配置的事务验证。
export async function startAuthProbeDatabase() {
  const versions = JSON.parse(
    await readFile("docs/architecture/versions.json", "utf8")
  )
  const passwords = Array.from({ length: 4 }, () =>
    randomBytes(24).toString("hex")
  )
  const container = await new GenericContainer(versions.postgresql.image)
    .withEnvironment({
      POSTGRES_USER: "bootstrap_admin",
      POSTGRES_DB: "enterprise_admin",
      POSTGRES_PASSWORD: passwords[0],
      APP_MIGRATOR_PASSWORD: passwords[1],
      APP_RUNTIME_PASSWORD: passwords[2],
      PLATFORM_RUNTIME_PASSWORD: passwords[3],
    })
    .withCopyFilesToContainer([
      {
        source: resolve("infra/postgres/bootstrap.sql"),
        target: "/docker-entrypoint-initdb.d/001-bootstrap.sql",
      },
    ])
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections", 2)
    )
    .start()
  const url = (user, password) =>
    `postgresql://${user}:${password}@${container.getHost()}:${container.getMappedPort(5432)}/enterprise_admin`
  return { container, url, passwords }
}
