import { createRequire } from "node:module"
import { randomBytes, randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { GenericContainer, Wait } from "testcontainers"
import { preview } from "vite"
import { chromium } from "playwright"
import { startTestApplication } from "./test-runtime.mjs"

const require = createRequire(resolve("apps/api/package.json"))
const { S3Client, CreateBucketCommand } = require("@aws-sdk/client-s3")
const versions = JSON.parse(
  await readFile("docs/architecture/versions.json", "utf8")
)
async function reservePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return port
}

export async function startPersonalAvatarBrowser(kind, resources) {
  const tenantPort = await reservePort(),
    platformPort = await reservePort()
  const tenantOrigin = `http://127.0.0.1:${tenantPort}`
  const platformOrigin = `http://127.0.0.1:${platformPort}`
  let files
  if (kind === "RustFS") {
    const accessKeyId = randomBytes(12).toString("hex"),
      secretAccessKey = randomBytes(32).toString("hex")
    const container = await new GenericContainer(versions.rustfs.image)
      .withEnvironment({
        RUSTFS_ACCESS_KEY: accessKeyId,
        RUSTFS_SECRET_KEY: secretAccessKey,
        RUSTFS_ADDRESS: ":9000",
        RUSTFS_CONSOLE_ENABLE: "false",
      })
      .withCommand(["/data"])
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp("/health/ready", 9000).forStatusCode(200))
      .start()
    resources.defer(() => container.stop())
    files = {
      kind: "s3",
      endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
      bucket: "avatar-browser-" + randomUUID(),
      prefix: "private-avatar",
      region: "us-east-1",
      accessKeyId,
      secretAccessKey,
    }
    const client = new S3Client({
      endpoint: files.endpoint,
      region: files.region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 1,
    })
    resources.defer(() => client.destroy())
    await client.send(new CreateBucketCommand({ Bucket: files.bucket }))
  }
  const environment = await startTestApplication({
    origins: [tenantOrigin, platformOrigin],
    files,
  })
  resources.defer(() => environment.close())
  let baseURL = environment.baseURL
  if (kind === "Local") {
    const config = {
      ...environment.containerConfig,
      baseURL: "http://127.0.0.1:3000",
      files: { kind: "local", root: "/tmp/avatar-browser-private" },
    }
    // 浏览器仍访问同一生产 createApplication；Linux 是 Local adapter 明确支持的部署边界。
    const container = await new GenericContainer(versions.nodeImage)
      .withNetwork(environment.containerNetwork)
      .withBindMounts([{ source: resolve("."), target: "/app", mode: "ro" }])
      .withWorkingDir("/app")
      .withEnvironment({ PERSONAL_AVATAR_CONFIG: JSON.stringify(config) })
      .withExposedPorts(3000)
      .withCommand([
        "node",
        "-e",
        `const {mkdir}=require('node:fs/promises');const {createApplication}=require('./apps/api/dist/create-application.js');(async()=>{const config=JSON.parse(process.env.PERSONAL_AVATAR_CONFIG);await mkdir(config.files.root,{recursive:true,mode:0o700});const app=await createApplication(config,{logger:['error']});await app.listen(3000,'0.0.0.0');console.log('PERSONAL_AVATAR_READY');process.once('SIGTERM',()=>app.close().then(()=>process.exit(0)));})().catch(error=>{console.error(error.code??error.message);process.exit(1)});`,
      ])
      .withWaitStrategy(Wait.forLogMessage("PERSONAL_AVATAR_READY"))
      .start()
    resources.defer(() => container.stop())
    baseURL = `http://${container.getHost()}:${container.getMappedPort(3000)}`
  }
  for (const [name, port] of [
    ["tenant", tenantPort],
    ["platform", platformPort],
  ]) {
    const server = await preview({
      root: resolve(`apps/${name}`),
      configFile: resolve(`apps/${name}/vite.config.ts`),
      preview: {
        host: "127.0.0.1",
        port,
        strictPort: true,
        proxy: { "/api": baseURL },
      },
    })
    resources.defer(() => server.close())
  }
  const browser = await chromium.launch()
  resources.defer(() => browser.close())
  return { ...environment, baseURL, tenantOrigin, platformOrigin, browser }
}
