import { containerHostURL } from "./container-host.mjs"
import { createRequire } from "node:module"
import { randomBytes, randomUUID } from "node:crypto"
import { createServer, request as httpRequest } from "node:http"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { GenericContainer, Wait } from "testcontainers"
import { startTestApplication } from "./test-runtime.mjs"

const require = createRequire(resolve("apps/api/package.json"))
const { FilesRuntime } = require("../../apps/api/dist/files/files-runtime.js")
const { storageKey } = require("../../apps/api/dist/files/storage/storage.js")
const { S3Client, CreateBucketCommand } = require("@aws-sdk/client-s3")
const versions = JSON.parse(
  await readFile("docs/architecture/versions.json", "utf8")
)

async function until(read, accepted, description) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const value = await read()
    if (accepted(value)) return value
    await delay(50)
  }
  throw new Error("Files process fixture timed out: " + description)
}

export async function startFilesProcessEnvironment(kind, resources) {
  let files, deleteGate, deleteHit
  if (kind === "RustFS") {
    const accessKeyId = randomBytes(12).toString("hex")
    const secretAccessKey = randomBytes(32).toString("hex")
    const rustfs = await new GenericContainer(versions.rustfs.image)
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
    resources.defer(() => rustfs.stop())
    files = {
      kind: "s3",
      endpoint: `http://${rustfs.getHost()}:${rustfs.getMappedPort(9000)}`,
      region: "us-east-1",
      bucket: "process-" + randomUUID(),
      prefix: "process-recovery",
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
  const environment = await startTestApplication({ files })
  resources.defer(() => environment.close())
  let applicationFiles = { kind: "local", root: "/tmp/process-files" }
  if (kind === "RustFS") {
    // 原样转发签名请求；只对指定真实 DELETE 的成功返回悬置，业务 API 从未被替换。
    const proxy = createServer((request, response) => {
      const upstream = httpRequest(
        new URL(request.url, files.endpoint),
        { method: request.method, headers: request.headers },
        (actual) => {
          const key = decodeURIComponent(
            new URL(request.url, "http://proxy").pathname
          )
          if (
            request.method === "DELETE" &&
            deleteGate === key &&
            actual.statusCode === 204
          ) {
            actual.resume()
            actual.once("end", () => {
              deleteHit = { key, status: actual.statusCode }
            })
            return
          }
          response.writeHead(actual.statusCode, actual.headers)
          actual.pipe(response)
        }
      )
      upstream.on("error", (error) => response.destroy(error))
      request.pipe(upstream)
    })
    proxy.listen(0, "0.0.0.0")
    await once(proxy, "listening")
    resources.defer(() => {
      proxy.closeAllConnections()
      return new Promise((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve()))
      )
    })
    applicationFiles = {
      ...files,
      endpoint: await containerHostURL(
        `http://127.0.0.1:${proxy.address().port}`
      ),
    }
  }
  const config = {
    ...environment.containerConfig,
    files: applicationFiles,
  }
  // holder 保留 Linux 文件系统；唯一被杀的是下方启动、记录 PID 的正式 API 子进程。
  const holder = await new GenericContainer(versions.nodeImage)
    .withNetwork(environment.containerNetwork)
    .withBindMounts([{ source: resolve("."), target: "/app", mode: "ro" }])
    .withWorkingDir("/app")
    .withEnvironment({ FILES_PROCESS_CONFIG: JSON.stringify(config) })
    .withExposedPorts(3000)
    .withCommand([
      "node",
      "-e",
      "console.log('FILES_PROCESS_HOLDER_READY');setInterval(()=>{},60000)",
    ])
    .withWaitStrategy(Wait.forLogMessage("FILES_PROCESS_HOLDER_READY"))
    .start()
  resources.defer(() => holder.stop())
  const execute = async (command) => {
    const result = await holder.exec(command)
    if (result.exitCode !== 0)
      throw new Error("Linux process fixture: " + result.output)
    return result.output.trim()
  }
  const read = (path) =>
    execute([
      "node",
      "-e",
      "const fs=require('node:fs');console.log(fs.existsSync(process.argv[1])?fs.readFileSync(process.argv[1],'utf8'):'')",
      path,
    ])
  const write = (path, value) =>
    execute([
      "node",
      "-e",
      "require('node:fs').writeFileSync(process.argv[1],process.argv[2])",
      path,
      value,
    ])
  const clear = (...paths) =>
    execute([
      "node",
      "-e",
      "const fs=require('node:fs');for(const path of process.argv.slice(1))if(fs.existsSync(path))fs.unlinkSync(path)",
      ...paths,
    ])
  let pid
  const start = async () => {
    await clear(
      "/tmp/files-api-pid",
      "/tmp/files-api-exit",
      "/tmp/files-api.log"
    )
    await execute([
      "sh",
      "-c",
      "(node /app/tests/setup/files-process-runtime.mjs; echo $? > /tmp/files-api-exit) </dev/null > /tmp/files-api.log 2>&1 &",
    ])
    await until(
      () => read("/tmp/files-api.log"),
      (text) => text.includes("FILES_PROCESS_API_READY"),
      "new API ready"
    )
    pid = Number(await read("/tmp/files-api-pid"))
    if (!Number.isSafeInteger(pid) || pid <= 1)
      throw new Error("API process PID is invalid")
    return pid
  }
  const kill = async () => {
    const killedPid = pid
    await execute([
      "node",
      "-e",
      "process.kill(Number(process.argv[1]),'SIGKILL')",
      String(killedPid),
    ])
    const exitCode = Number(
      await until(
        () => read("/tmp/files-api-exit"),
        (text) => text !== "",
        "SIGKILL exit"
      )
    )
    pid = undefined
    return { pid: killedPid, exitCode }
  }
  const clearGate = async () => {
    deleteGate = undefined
    deleteHit = undefined
    await clear("/tmp/files-gate.json", "/tmp/files-gate-hit.json")
  }
  await start()
  const directStorage =
    kind === "RustFS"
      ? environment.app.get(FilesRuntime).requireStorage()
      : undefined
  return {
    ...environment,
    filesBaseURL: `http://${holder.getHost()}:${holder.getMappedPort(3000)}`,
    pid: () => pid,
    kill,
    restart: async () => {
      if (pid) await kill()
      await clearGate()
      return start()
    },
    gate: (stage, method, address) =>
      write("/tmp/files-gate.json", JSON.stringify({ stage, method, address })),
    gateHit: () =>
      until(
        async () => {
          const text = await read("/tmp/files-gate-hit.json")
          return text ? JSON.parse(text) : null
        },
        Boolean,
        "storage gate"
      ),
    loseDelete: (address) => {
      if (kind === "Local")
        return write(
          "/tmp/files-gate.json",
          JSON.stringify({ stage: "after", method: "remove", address })
        )
      deleteGate = `/${files.bucket}/${files.prefix}/${storageKey(address)}`
      return Promise.resolve()
    },
    lostDeleteHit: () =>
      kind === "Local"
        ? until(
            async () => {
              const text = await read("/tmp/files-gate-hit.json")
              return text ? JSON.parse(text) : null
            },
            Boolean,
            "unlink return lost"
          )
        : until(
            () => Promise.resolve(deleteHit),
            Boolean,
            "actual RustFS DELETE response lost"
          ),
    physical: async (address, directory = false) => {
      if (directStorage) {
        if (directory) return directStorage.directoryExists(address)
        try {
          const content = await directStorage.open(address)
          const chunks = []
          for await (const chunk of content.body) chunks.push(chunk)
          return Buffer.concat(chunks)
        } catch (error) {
          if (error.code === "STORAGE_NOT_FOUND") return null
          throw error
        }
      }
      const result = await execute([
        "node",
        "-e",
        "const {createFileStorage}=require('./apps/api/dist/files/storage/storage.js');(async()=>{const storage=await createFileStorage(JSON.parse(process.env.FILES_PROCESS_CONFIG).files);try{const address=JSON.parse(process.argv[1]);let result;if(process.argv[2]==='directory')result=await storage.directoryExists(address);else{try{const read=await storage.open(address);const chunks=[];for await(const chunk of read.body)chunks.push(chunk);result=Buffer.concat(chunks).toString('base64')}catch(error){if(error.code==='STORAGE_NOT_FOUND')result=null;else throw error}}console.log(JSON.stringify(result));}finally{await storage[Symbol.asyncDispose]()}})().catch(error=>{console.error(error.code??error.message);process.exitCode=1})",
        JSON.stringify(address),
        directory ? "directory" : "content",
      ])
      const value = JSON.parse(result)
      return directory || value === null ? value : Buffer.from(value, "base64")
    },
    ownerLockAvailable: async (organizationId) => {
      const client = await environment.observer.connect()
      const key = `enterprise-admin:files:organization:${organizationId}`
      try {
        const result = await client.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",
          [key]
        )
        if (result.rows[0].acquired)
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended($1,0))",
            [key]
          )
        return result.rows[0].acquired
      } finally {
        client.release()
      }
    },
  }
}
