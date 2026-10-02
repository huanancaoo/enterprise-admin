import { createRequire } from "node:module"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { GenericContainer, Wait } from "testcontainers"
import { startTestApplication } from "./test-runtime.mjs"

const require = createRequire(resolve("apps/api/package.json"))
const { FilesRuntime } = require("../../apps/api/dist/files/files-runtime.js")
const {
  FileMaintenance,
} = require("../../apps/api/dist/files/file-maintenance.js")
const { S3Client, CreateBucketCommand } = require("@aws-sdk/client-s3")
const versions = JSON.parse(
  await readFile("docs/architecture/versions.json", "utf8")
)

const localAction = `
const {mkdir} = require('node:fs/promises');
const {createApplication} = require('./apps/api/dist/create-application.js');
const {FilesRuntime} = require('./apps/api/dist/files/files-runtime.js');
const {FileMaintenance} = require('./apps/api/dist/files/file-maintenance.js');
const config=JSON.parse(process.env.FILES_TEST_CONFIG);
const input=JSON.parse(process.argv[1]);
(async()=>{
  await mkdir(config.files.root,{recursive:true,mode:0o700});
  const app=await createApplication(config,{logger:false});
  try {
    await app.init();
    const storage=app.get(FilesRuntime).requireStorage();
    let result;
    if(input.method==='maintenance') result=await app.get(FileMaintenance)[input.action](...(input.arguments??[]));
    else if(input.method==='write') {
      const body=Buffer.from(input.base64,'base64');
      result=await storage.write(input.address,(async function*(){yield body})(),body.length);
    } else if(input.method==='read') {
      try {
        const read=await storage.open(input.address);
        const chunks=[];for await(const chunk of read.body) chunks.push(chunk);
        result={base64:Buffer.concat(chunks).toString('base64')};
      } catch(error) {if(error.code==='STORAGE_NOT_FOUND') result={missing:true};else throw error;}
    } else result=await storage[input.method](...(input.arguments??[]));
    console.log(JSON.stringify({result:result??null}));
  } finally {await app.close();}
})().catch(error=>{console.error(error.code??error.message);process.exitCode=1});
`

export async function startFilesEnvironment(kind, resources) {
  let config
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
    config = {
      kind: "s3",
      endpoint: `http://${rustfs.getHost()}:${rustfs.getMappedPort(9000)}`,
      region: "us-east-1",
      bucket: "maintenance-" + randomUUID(),
      prefix: "private-suite",
      accessKeyId,
      secretAccessKey,
    }
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 1,
    })
    resources.defer(() => client.destroy())
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }))
  }
  const environment = await startTestApplication({ files: config })
  resources.defer(() => environment.close())
  let invoke
  if (kind === "Local") {
    const remote = (value) => {
      const url = new URL(value)
      url.hostname = "host.docker.internal"
      return url.toString()
    }
    const applicationConfig = {
      ...environment.config,
      databaseURL: remote(environment.config.databaseURL),
      redisURL: remote(environment.config.redisURL),
      files: { kind: "local", root: "/tmp/maintenance-files" },
    }
    const container = await new GenericContainer(versions.nodeImage)
      .withBindMounts([{ source: resolve("."), target: "/app", mode: "ro" }])
      .withWorkingDir("/app")
      .withEnvironment({ FILES_TEST_CONFIG: JSON.stringify(applicationConfig) })
      .withCommand([
        "node",
        "-e",
        "console.log('FILES_LINUX_READY');setInterval(()=>{},60000)",
      ])
      .withWaitStrategy(Wait.forLogMessage("FILES_LINUX_READY"))
      .start()
    resources.defer(() => container.stop())
    invoke = async (input) => {
      const response = await container.exec([
        "node",
        "-e",
        localAction,
        JSON.stringify(input),
      ])
      if (response.exitCode !== 0)
        throw new Error(
          "Actual Linux Files execution failed: " + response.output
        )
      return JSON.parse(response.output.trim()).result
    }
  } else {
    const storage = environment.app.get(FilesRuntime).requireStorage()
    invoke = async (input) => {
      if (input.method === "maintenance")
        return environment.app
          .get(FileMaintenance)
          [input.action](...(input.arguments ?? []))
      if (input.method === "write") {
        const body = Buffer.from(input.base64, "base64")
        return storage.write(
          input.address,
          (async function* () {
            yield body
          })(),
          body.length
        )
      }
      if (input.method === "read") {
        try {
          const read = await storage.open(input.address)
          const chunks = []
          for await (const chunk of read.body) chunks.push(chunk)
          return { base64: Buffer.concat(chunks).toString("base64") }
        } catch (error) {
          if (error.code === "STORAGE_NOT_FOUND") return { missing: true }
          throw error
        }
      }
      return storage[input.method](...(input.arguments ?? []))
    }
  }
  return {
    ...environment,
    physical: {
      ensureOwner: (owner) =>
        invoke({ method: "ensureOwner", arguments: [owner] }),
      createDirectory: (address) =>
        invoke({ method: "createDirectory", arguments: [address] }),
      directoryExists: (address) =>
        invoke({ method: "directoryExists", arguments: [address] }),
      copy: (source, target, facts) =>
        invoke({ method: "copy", arguments: [source, target, facts] }),
      write: (address, body) =>
        invoke({ method: "write", address, base64: body.toString("base64") }),
      read: (address) => invoke({ method: "read", address }),
      remove: (address) => invoke({ method: "remove", arguments: [address] }),
      removeDirectory: (address) =>
        invoke({ method: "removeDirectory", arguments: [address] }),
    },
    maintenance: (action, ...arguments_) =>
      invoke({ method: "maintenance", action, arguments: arguments_ }),
  }
}
