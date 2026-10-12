import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

let environment, child, closed, actor, organization, baseURL
let output = ""
const applicationName = `operational-log-${randomUUID()}`
const script = `const {createApplication}=require('./apps/api/dist/create-application.js');const {operationalNestLogger}=require('./apps/api/dist/http/operational-logger.js');(async()=>{const app=await createApplication(JSON.parse(process.env.TEST_APPLICATION_CONFIG),{logger:operationalNestLogger});await app.listen(0,'127.0.0.1');console.log('TEST_API_URL='+await app.getUrl());process.once('SIGTERM',()=>app.close().then(()=>process.exit(0)));})().catch(()=>process.exit(1));`
beforeAll(async () => {
  environment = await startTestApplication()
  actor = await signUpVerified(
    environment.baseURL,
    "http://localhost:3200",
    environment.migrator
  )
  organization = await environment.runtime.auth.api.createOrganization({
    headers: actor.headers,
    body: { name: "Log privacy", slug: randomUUID() },
  })
  const processConfig = { ...environment.config }
  const connection = new URL(processConfig.databaseURL)
  connection.searchParams.set("application_name", applicationName)
  processConfig.databaseURL = connection.href
  child = spawn(process.execPath, ["-e", script], {
    env: {
      ...process.env,
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
      TEST_APPLICATION_CONFIG: JSON.stringify(processConfig),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.on("data", (chunk) => {
    output += chunk
  })
  child.stderr.on("data", (chunk) => {
    output += chunk
  })
  closed = new Promise((resolve) => child.once("exit", resolve))
  await vi.waitFor(
    () =>
      expect(/TEST_API_URL=(http:\/\/[^\s]+)/.exec(output)?.[1]).toBeTruthy(),
    { timeout: 10000 }
  )
  baseURL = /TEST_API_URL=(http:\/\/[^\s]+)/.exec(output)[1]
})
afterAll(async () => {
  child?.kill("SIGTERM")
  await closed
  await environment?.close()
})
test("正式错误日志不得包含SQL参数中的请求秘密，保留受控错误与关联标识", async () => {
  const secret = `synthetic-auth-secret-${randomUUID()}`
  // 只撤销真实运行角色的INSERT授权来注入基础设施错误；正式表、迁移与业务授权保持实际链路。
  await environment.migrator.query(
    "REVOKE INSERT ON public.project_translations FROM app_runtime"
  )
  try {
    const response = await fetch(
      `${baseURL}/api/v1/organizations/${organization.id}/projects`,
      {
        method: "POST",
        headers: {
          ...Object.fromEntries(actor.headers),
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Failure log", description: secret }),
      }
    )
    expect(response.status).toBe(500)
    const failure = await response.json()
    expect(failure.code).toBe("INTERNAL_ERROR")
    await expect.poll(() => output.includes(failure.requestId)).toBe(true)
    expect(output).toContain("api.request.failed")
    expect(output).not.toContain(secret)
    const projects = await fetch(
      `${baseURL}/api/v1/organizations/${organization.id}/projects?name=Failure%20log`,
      { headers: actor.headers }
    ).then((value) => value.json())
    expect(projects.items).toEqual([])
  } finally {
    await environment.migrator.query(
      "GRANT INSERT ON public.project_translations TO app_runtime"
    )
  }
})
test("JSON解析错误返回400且不把原始请求体写入生产日志", async () => {
  const secret = `synthetic-body-secret-${randomUUID()}`
  const response = await fetch(
    `${baseURL}/api/v1/organizations/${organization.id}/projects`,
    {
      method: "POST",
      headers: {
        ...Object.fromEntries(actor.headers),
        "content-type": "application/json",
      },
      body: '{"name":"' + secret + '"',
    }
  )
  expect(response.status).toBe(400)
  const failure = await response.json()
  expect(failure.code).toBe("VALIDATION_ERROR")
  await expect.poll(() => output.includes(failure.requestId)).toBe(true)
  expect(output).not.toContain(secret)
})

test("数据库主动断开空闲连接时只记录受控诊断，后续正式HTTP仍可用", async () => {
  const url = `${baseURL}/api/v1/organizations/${organization.id}/projects`
  expect((await fetch(url, { headers: actor.headers })).status).toBe(200)
  // 管理连接只负责注入断连；API 始终保留真实 app_runtime 身份。
  const terminated = await environment.observer.query(
    "SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE application_name=$1 AND state='idle'",
    [applicationName]
  )
  expect(terminated.rows.length).toBeGreaterThan(0)
  expect(terminated.rows.every((row) => row.terminated)).toBe(true)
  await vi.waitFor(() => expect(output).toContain("database.pool.failed"))
  expect(child.exitCode).toBeNull()
  expect(output).not.toContain("Unhandled 'error' event")
  expect(output).not.toContain("secretKey")
  expect(output).not.toContain(environment.config.databaseURL)
  expect((await fetch(url, { headers: actor.headers })).status).toBe(200)
})
