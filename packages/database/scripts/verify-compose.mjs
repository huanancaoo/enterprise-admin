import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const cwd = fileURLToPath(new URL("../../../", import.meta.url))
const project = `enterprise-s2-${randomBytes(6).toString("hex")}`
const env = {
  ...process.env,
  POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
  APP_MIGRATOR_PASSWORD: randomBytes(24).toString("hex"),
  APP_RUNTIME_PASSWORD: randomBytes(24).toString("hex"),
  PLATFORM_RUNTIME_PASSWORD: randomBytes(24).toString("hex"),
  POSTGRES_PORT: "0",
}
env.MIGRATION_DATABASE_URL = `postgresql://app_migrator:${env.APP_MIGRATOR_PASSWORD}@postgres:5432/enterprise_admin`
const args = [
  "compose",
  "-p",
  project,
  "-f",
  "compose.yaml",
  "-f",
  "compose.migration.yaml",
]
const run = (...command) =>
  execFileSync("docker", [...args, ...command], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim()
const query = (sql) =>
  run(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "bootstrap_admin",
    "-d",
    "enterprise_admin",
    "-v",
    "ON_ERROR_STOP=1",
    "-Atc",
    sql
  )

try {
  run("build", "migrator")
  run("up", "-d", "--wait", "postgres")
  run("run", "--rm", "migrator")
  assert.equal(query("SELECT count(*) FROM drizzle.__drizzle_migrations"), "2")
  query(
    "INSERT INTO public.organization (id,name,slug,created_at) VALUES (gen_random_uuid(),'Persistence probe','s2-persistence',now())"
  )
  // 销毁容器但保留命名卷；重新创建后必须仍能读取迁移历史和业务行。
  run("down")
  run("up", "-d", "--wait", "postgres")
  assert.equal(
    query(
      "SELECT count(*) FROM public.organization WHERE slug='s2-persistence'"
    ),
    "1"
  )
  run("run", "--rm", "migrator")
  assert.equal(query("SELECT count(*) FROM drizzle.__drizzle_migrations"), "2")
  const failed = spawnSync("docker", [...args, "run", "--rm", "migrator"], {
    cwd,
    env: {
      ...env,
      MIGRATION_DATABASE_URL: `postgresql://app_runtime:${env.APP_RUNTIME_PASSWORD}@postgres:5432/enterprise_admin`,
    },
    encoding: "utf8",
  })
  if (failed.error) throw failed.error
  assert.notEqual(failed.status, null)
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /Migration must run as app_migrator/)
  console.log(
    "PASS S2 Compose: 镜像迁移、数据卷重建持久化、重复迁移及失败退出码"
  )
} finally {
  // 项目名每次随机生成，只删除本次测试创建的容器、卷和镜像。
  run("down", "--volumes", "--rmi", "local")
}
