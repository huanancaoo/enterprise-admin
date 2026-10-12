import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { beforeAll, expect, test } from "vitest"

const baseline =
  "postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af"
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
const snapshotSQL = `SELECT jsonb_build_object('database',(SELECT jsonb_build_object('provider',datlocprovider,'collate',to_jsonb(d)->'datcollate','ctype',to_jsonb(d)->'datctype','locale',to_jsonb(d)->'datlocale','version',datcollversion,'actual',pg_database_collation_actual_version(oid)) FROM pg_database d WHERE datname=current_database()),'collations',(SELECT jsonb_agg(row_to_json(c) ORDER BY collname,collnamespace) FROM (SELECT c.*,pg_collation_actual_version(oid) AS actual FROM pg_collation c) c),'rows',(SELECT jsonb_agg(value ORDER BY value) FROM collation_probe),'version',current_setting('server_version'))::text`
beforeAll(() => {
  if (!process.env.RELEASE_DATABASE_IMAGE)
    docker([
      "build",
      "--provenance=false",
      "-f",
      "infra/release/base/Dockerfile.database",
      "--target",
      "postgres",
      "-t",
      "enterprise-admin-postgres:18.6-security-1",
      ".",
    ])
  if (!process.env.RELEASE_REDIS_TEST_IMAGE)
    docker([
      "build",
      "--provenance=false",
      "-f",
      "infra/release/base/Dockerfile.database",
      "--target",
      "redis",
      "-t",
      "enterprise-admin-redis:7.4.5-security-1",
      ".",
    ])
})

test("既定 PostgreSQL/Bookworm 的安全库更新保留全部collation版本、数据与排序结果", async () => {
  const image =
    process.env.RELEASE_DATABASE_IMAGE ??
    "enterprise-admin-postgres:18.6-security-1"
  const name = `base-collation-${randomBytes(6).toString("hex")}`
  const volume = name + "-data",
    password = randomBytes(24).toString("hex")
  let container
  const start = (reference) => {
    container = docker([
      "run",
      "-d",
      "--name",
      name,
      "-v",
      `${volume}:/var/lib/postgresql`,
      "-e",
      "POSTGRES_USER=postgres",
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      "POSTGRES_DB=enterprise_admin",
      reference,
    ])
  }
  const query = (sql) =>
    docker([
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "enterprise_admin",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      sql,
    ])
  try {
    start(baseline)
    await expect
      .poll(
        () => {
          try {
            return docker([
              "exec",
              container,
              "pg_isready",
              "-h",
              "127.0.0.1",
              "-U",
              "postgres",
              "-d",
              "enterprise_admin",
            ])
          } catch {
            return "starting"
          }
        },
        { timeout: 20_000 }
      )
      .toContain("accepting connections")
    query(
      "CREATE TABLE collation_probe(value text NOT NULL); INSERT INTO collation_probe VALUES ('Z'),('ä'),('Å'),('a'),('a-a'),('a_a'),('北京');"
    )
    const before = query(snapshotSQL)
    const libraries = docker([
      "exec",
      container,
      "dpkg-query",
      "-W",
      "-f=${Package}=${Version}\n",
      "libc6",
      "libc-bin",
      "locales",
      "libicu72",
      "tzdata",
    ])
    docker(["stop", "-t", "20", container])
    docker(["rm", container])
    container = undefined
    start(image)
    await expect
      .poll(
        () => {
          try {
            return docker([
              "exec",
              container,
              "pg_isready",
              "-h",
              "127.0.0.1",
              "-U",
              "postgres",
              "-d",
              "enterprise_admin",
            ])
          } catch {
            return "starting"
          }
        },
        { timeout: 20_000 }
      )
      .toContain("accepting connections")
    expect(query(snapshotSQL)).toBe(before)
    expect(
      docker([
        "exec",
        container,
        "dpkg-query",
        "-W",
        "-f=${Package}=${Version}\n",
        "libc6",
        "libc-bin",
        "locales",
        "libicu72",
        "tzdata",
      ])
    ).toBe(libraries)
    expect(
      docker([
        "exec",
        container,
        "dpkg-query",
        "-W",
        "-f=${Version}",
        "libssl3",
      ])
    ).toBe("3.0.22-1~deb12u1")
    expect(docker(["exec", container, "gosu", "--version"])).toContain(
      "go1.27.2"
    )
  } finally {
    if (container) {
      try {
        docker(["rm", "-f", container])
      } catch {}
    }
    docker(["volume", "rm", volume])
  }
})

test("既定 Redis/Bookworm 安全更新读回旧 RDB 且保持运行库与 Redis 版本", async () => {
  const image =
    process.env.RELEASE_REDIS_TEST_IMAGE ??
    "enterprise-admin-redis:7.4.5-security-1"
  const name = `base-redis-${randomBytes(6).toString("hex")}`,
    volume = name + "-data"
  let container
  const start = (reference) => {
    container = docker([
      "run",
      "-d",
      "--name",
      name,
      "-v",
      `${volume}:/data`,
      reference,
    ])
  }
  const query = (...args) =>
    docker(["exec", container, "redis-cli", "--raw", ...args])
  const snapshot = () => [
    query("GET", "application-probe"),
    query("LRANGE", "pending-probe", "0", "-1"),
    query("ZRANGE", "delayed-probe", "0", "-1", "WITHSCORES"),
    query("INFO", "server").match(/^redis_version:.*$/m)?.[0],
  ]
  try {
    start(
      "redis:7.4.5-bookworm@sha256:90e7a336d044f1abc9e9dbc05d65566850896d11453bbd1dd0fb7e5059f0e8fb"
    )
    await expect
      .poll(
        () => {
          try {
            return query("PING")
          } catch {
            return "starting"
          }
        },
        { timeout: 20_000 }
      )
      .toBe("PONG")
    query("SET", "application-probe", "持久事实")
    query("RPUSH", "pending-probe", "task-first", "task-second")
    query("ZADD", "delayed-probe", "1730000000", "task-delayed")
    const before = snapshot(),
      libraries = docker([
        "exec",
        container,
        "dpkg-query",
        "-W",
        "-f=${Package}=${Version}\n",
        "libc6",
        "libc-bin",
        "tzdata",
      ])
    expect(query("SAVE")).toBe("OK")
    docker(["stop", "-t", "20", container])
    docker(["rm", container])
    container = undefined
    start(image)
    await expect
      .poll(
        () => {
          try {
            return query("PING")
          } catch {
            return "starting"
          }
        },
        { timeout: 20_000 }
      )
      .toBe("PONG")
    expect(snapshot()).toEqual(before)
    expect(
      docker([
        "exec",
        container,
        "dpkg-query",
        "-W",
        "-f=${Package}=${Version}\n",
        "libc6",
        "libc-bin",
        "tzdata",
      ])
    ).toBe(libraries)
    expect(
      docker([
        "exec",
        container,
        "dpkg-query",
        "-W",
        "-f=${Version}",
        "libssl3",
      ])
    ).toBe("3.0.22-1~deb12u1")
    expect(docker(["exec", container, "gosu", "--version"])).toContain(
      "go1.27.2"
    )
  } finally {
    if (container) {
      try {
        docker(["rm", "-f", container])
      } catch {}
    }
    docker(["volume", "rm", volume])
  }
})

test("固定本地基础配方的连续缓存构建保留全部镜像身份", () => {
  const imageIds = () =>
    docker([
      "image",
      "inspect",
      "enterprise-admin-postgres:18.6-security-1",
      "enterprise-admin-redis:7.4.5-security-1",
      "enterprise-admin-mailpit:1.30.4-security-1",
      "enterprise-admin-otel-collector:0.162.0-security-1",
      "enterprise-admin-prometheus:3.15.0-security-1",
      "enterprise-admin-tracing:2.22.0-security-1",
      "--format",
      "{{.Id}}",
    ])
  const build = () =>
    execFileSync(process.execPath, ["infra/release/build-base-images.mjs"], {
      stdio: ["ignore", "ignore", "pipe"],
    })
  build()
  const accepted = imageIds()
  build()
  expect(imageIds()).toBe(accepted)
})

test("Compose部署配置重复使用已准备镜像，不能改变基础镜像身份", () => {
  const references = [
    "enterprise-admin-postgres:18.6-security-1",
    "enterprise-admin-redis:7.4.5-security-1",
    "enterprise-admin-mailpit:1.30.4-security-1",
    "enterprise-admin-otel-collector:0.162.0-security-1",
    "enterprise-admin-prometheus:3.15.0-security-1",
    "enterprise-admin-tracing:2.22.0-security-1",
  ]
  execFileSync(process.execPath, ["infra/release/build-base-images.mjs"], {
    stdio: ["ignore", "ignore", "pipe"],
  })
  const accepted = docker([
    "image",
    "inspect",
    ...references,
    "--format",
    "{{.Id}}",
  ])
  const env = { ...process.env }
  for (const name of [
    "POSTGRES_PASSWORD",
    "APP_MIGRATOR_PASSWORD",
    "APP_RUNTIME_PASSWORD",
    "PLATFORM_RUNTIME_PASSWORD",
    "PLATFORM_DEPLOYER_PASSWORD",
    "BETTER_AUTH_SECRET",
    "EMAIL_PAYLOAD_ENCRYPTION_KEY",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "RELEASE_API_IMAGE",
    "RELEASE_WORKER_IMAGE",
    "RELEASE_TENANT_IMAGE",
    "RELEASE_PLATFORM_IMAGE",
    "RELEASE_MIGRATOR_IMAGE",
  ])
    env[name] = "identity-not-running"
  Object.assign(env, {
    MIGRATION_DATABASE_URL:
      "postgresql://not-running:not-running@postgres/enterprise_admin",
    RELEASE_TENANT_ORIGIN: "http://127.0.0.1:1",
    RELEASE_PLATFORM_ORIGIN: "http://127.0.0.1:2",
    RELEASE_TENANT_PORT: "1",
    RELEASE_PLATFORM_PORT: "2",
    RELEASE_MAIL_PORT: "3",
  })
  execFileSync(
    "docker",
    [
      "compose",
      "-p",
      "framework-base-identity-test",
      "-f",
      "compose.release.yaml",
      "build",
      "postgres",
      "redis",
      "mailpit",
      "otel-collector",
      "prometheus",
      "tracing",
    ],
    { env, stdio: ["ignore", "ignore", "pipe"] }
  )
  expect(
    docker(["image", "inspect", ...references, "--format", "{{.Id}}"])
  ).toBe(accepted)
})
