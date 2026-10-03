import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { GenericContainer } from "testcontainers"
import { expect, test } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"

test("Linux API 容器在独立网络直连数据库运行角色与 Redis", async () => {
  const resources = new AsyncDisposableStack()
  try {
    const environment = await startTestApplication()
    resources.defer(() => environment.close())
    const versions = JSON.parse(
      await readFile("docs/architecture/versions.json", "utf8")
    )
    const container = await new GenericContainer(versions.nodeImage)
      .withNetwork(environment.containerNetwork)
      .withBindMounts([{ source: resolve("."), target: "/app", mode: "ro" }])
      .withWorkingDir("/app")
      .withEnvironment({
        SERVICES_TEST_CONFIG: JSON.stringify(environment.containerConfig),
      })
      .withCommand(["sleep", "infinity"])
      .start()
    resources.defer(() => container.stop())
    const result = await container.exec([
      "node",
      "--input-type=module",
      "-e",
      `import {createDatabase} from './packages/database/dist/index.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Redis=require('./apps/api/node_modules/ioredis');
const config=JSON.parse(process.env.SERVICES_TEST_CONFIG);
const {pool}=createDatabase(config.databaseURL);
const redis=new Redis(config.redisURL,{lazyConnect:true});
try {
  await redis.connect();
  const {rows:[database]}=await pool.query('SELECT current_user AS role, current_database() AS name');
  console.log(JSON.stringify({...database,redis:await redis.ping()}));
} finally {redis.disconnect();await pool.end();}`,
    ])
    expect(result.exitCode, result.output).toBe(0)
    expect(JSON.parse(result.output.trim())).toEqual({
      role: "app_runtime",
      name: "enterprise_admin",
      redis: "PONG",
    })
  } finally {
    await resources.disposeAsync()
  }
})
