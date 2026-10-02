import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createRequire } from "node:module"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { GenericContainer, Wait } from "testcontainers"
import { registerFileStorageMatrix } from "../setup/file-storage-matrix.mjs"
import { registerLocalStorageCases } from "../setup/local-storage.test-driver.mjs"

const require = createRequire(resolve("apps/api/package.json"))
const {
  createFileStorage,
  storageKey,
} = require("../../apps/api/dist/files/storage/storage.js")
const {
  S3Client,
  CreateBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3")
const versions = JSON.parse(
  await readFile("docs/architecture/versions.json", "utf8")
)

describe("Local：生产存储模块连接 Linux 私有文件系统", () => {
  let container
  beforeAll(async () => {
    container = await new GenericContainer(versions.nodeImage)
      .withCopyDirectoriesToContainer([
        {
          source: resolve("apps/api/dist/files/storage"),
          target: "/app/apps/api/dist/files/storage",
        },
        {
          source: resolve("packages/contracts/dist"),
          target: "/app/node_modules/@workspace/contracts/dist",
        },
      ])
      .withCopyFilesToContainer([
        {
          source: resolve("packages/contracts/package.json"),
          target: "/app/node_modules/@workspace/contracts/package.json",
        },
        {
          source: resolve("tests/setup/file-storage-matrix.mjs"),
          target: "/app/tests/setup/file-storage-matrix.mjs",
        },
        {
          source: resolve("tests/setup/local-storage.test-driver.mjs"),
          target: "/app/tests/setup/local-storage.test-driver.mjs",
        },
      ])
      .withCommand([
        "node",
        "-e",
        "console.log('LOCAL_STORAGE_READY');setInterval(()=>{},60000)",
      ])
      .withWaitStrategy(Wait.forLogMessage("LOCAL_STORAGE_READY"))
      .start()
  })
  afterAll(async () => {
    await container?.stop()
  })
  registerLocalStorageCases((name) => {
    test(name, async () => {
      const result = await container.exec([
        "node",
        "/app/tests/setup/local-storage.test-driver.mjs",
        name,
      ])
      expect(result.exitCode, result.output).toBe(0)
    })
  }, {})
})

describe("S3：生产存储模块连接固定版本真实 RustFS", () => {
  const resources = new AsyncDisposableStack()
  const fixture = {}
  let client, config, container
  beforeAll(async () => {
    try {
      const accessKeyId = randomBytes(12).toString("hex")
      const secretAccessKey = randomBytes(32).toString("hex")
      container = await new GenericContainer(versions.rustfs.image)
        .withEnvironment({
          RUSTFS_ACCESS_KEY: accessKeyId,
          RUSTFS_SECRET_KEY: secretAccessKey,
          RUSTFS_ADDRESS: ":9000",
          RUSTFS_CONSOLE_ENABLE: "false",
        })
        .withCommand(["/data"])
        .withExposedPorts(9000)
        .withWaitStrategy(
          Wait.forHttp("/health/ready", 9000).forStatusCode(200)
        )
        .withStartupTimeout(120_000)
        .start()
      resources.defer(() => container.stop())
      config = {
        kind: "s3",
        region: "us-east-1",
        endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
        bucket: `storage-${randomUUID()}`,
        prefix: "isolated-suite",
        accessKeyId,
        secretAccessKey,
      }
      client = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
        maxAttempts: 1,
      })
      resources.defer(() => {
        client.destroy()
      })
      await client.send(new CreateBucketCommand({ Bucket: config.bucket }))
      fixture.storage = await createFileStorage(config)
      resources.defer(() => fixture.storage[Symbol.asyncDispose]())
      const key = (address, directory = false) =>
        `${config.prefix}/${storageKey(address, directory)}`
      fixture.key = key
      fixture.reopen = () => createFileStorage(config)
      fixture.inspectDirectory = async (address) => {
        try {
          const info = await client.send(
            new HeadObjectCommand({
              Bucket: config.bucket,
              Key: key(address, true),
            })
          )
          expect(info.ContentLength).toBe(0)
          return true
        } catch (error) {
          if (error.$metadata?.httpStatusCode === 404) return false
          throw error
        }
      }
      fixture.inspectAbsent = async (address) => {
        try {
          await client.send(
            new HeadObjectCommand({ Bucket: config.bucket, Key: key(address) })
          )
          return false
        } catch (error) {
          if (error.$metadata?.httpStatusCode === 404) return true
          throw error
        }
      }
      fixture.inspectContent = async (address) => {
        const result = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key(address) })
        )
        return Buffer.from(await result.Body.transformToByteArray())
      }
    } catch (error) {
      try {
        await resources.disposeAsync()
      } catch (cleanupError) {
        throw new SuppressedError(
          cleanupError,
          error,
          "RustFS 测试启动及资源清理失败"
        )
      }
      throw error
    }
  })
  afterAll(() => resources.disposeAsync())

  // fixture 在 beforeAll 填充，测试回调读取同一个对象中的真实存储资源。
  registerFileStorageMatrix(test, fixture)

  test("私有 bucket 的匿名读取拒绝", async () => {
    const address = {
      owner: { kind: "organization", id: randomUUID() },
      area: "files",
      segments: [],
    }
    await fixture.storage.createDirectory(address)
    const file = { ...address, segments: ["private.bin"] }
    await fixture.storage.write(
      file,
      (async function* () {
        yield Buffer.from("private")
      })(),
      7
    )
    const response = await fetch(
      `${config.endpoint}/${config.bucket}/${fixture.key(file)}`
    )
    expect(response.status).toBe(403)
  })

  test("真实 prefix/delimiter 列出直接文件和目录，不串入其他组织", async () => {
    const owner = { kind: "organization", id: randomUUID() }
    const at = (...segments) => ({ owner, area: "files", segments })
    const other = {
      owner: { ...owner, id: randomUUID() },
      area: "files",
      segments: [],
    }
    await fixture.storage.createDirectory(at())
    await fixture.storage.createDirectory(at("空目录"))
    await fixture.storage.createDirectory(at("nested"))
    await fixture.storage.createDirectory(at("nested", "深层"))
    await fixture.storage.createDirectory(other)
    await fixture.storage.write(
      at("direct"),
      (async function* () {
        yield Buffer.from("a")
      })(),
      1
    )
    await fixture.storage.write(
      { ...other, segments: ["private"] },
      (async function* () {
        yield Buffer.from("b")
      })(),
      1
    )
    const prefix = fixture.key(at(), true)
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        Delimiter: "/",
      })
    )
    expect(result.Contents.map((object) => object.Key).sort()).toEqual(
      [prefix, `${prefix}direct`].sort()
    )
    expect(result.CommonPrefixes.map((item) => item.Prefix).sort()).toEqual(
      [`${prefix}nested/`, `${prefix}空目录/`].sort()
    )
    expect(result.IsTruncated).toBe(false)
  })

  test("最大部署前缀仍可保存完整路径与 1024 字节目录标记", async () => {
    const prefix = ["a".repeat(255), "b".repeat(186)].join("/")
    const storage = await createFileStorage({ ...config, prefix })
    try {
      const owner = { kind: "organization", id: randomUUID() }
      const at = (...segments) => ({ owner, area: "staging", segments })
      const parent = ["a".repeat(246), "b".repeat(246)]
      await storage.createDirectory(at())
      await storage.createDirectory(at(parent[0]))
      await storage.createDirectory(at(...parent))
      const directory = at(...parent, "c".repeat(18))
      await storage.createDirectory(directory)
      const marker = `${prefix}/${storageKey(directory, true)}`
      expect(Buffer.byteLength(marker)).toBe(1024)
      expect(
        (
          await client.send(
            new HeadObjectCommand({ Bucket: config.bucket, Key: marker })
          )
        ).ContentLength
      ).toBe(0)
      const file = at(...parent, "d".repeat(18))
      await storage.write(
        file,
        (async function* () {
          yield Buffer.from("a")
        })(),
        1
      )
      const read = await storage.open(file)
      const actual = []
      for await (const chunk of read.body) actual.push(chunk)
      expect(Buffer.concat(actual)).toEqual(Buffer.from("a"))
    } finally {
      await storage[Symbol.asyncDispose]()
    }
  })

  test("配置错误不创建 bucket 或切换存储，基准前缀必须为全路径保留空间", async () => {
    await expect(
      createFileStorage({ ...config, bucket: `missing-${randomUUID()}` })
    ).rejects.toMatchObject({ code: "STORAGE_CONFIG_INVALID" })
    await expect(
      createFileStorage({ ...config, prefix: "a/../b" })
    ).rejects.toMatchObject({ code: "STORAGE_CONFIG_INVALID" })
    await expect(
      createFileStorage({
        ...config,
        prefix: ["a".repeat(255), "b".repeat(187)].join("/"),
      })
    ).rejects.toMatchObject({ code: "STORAGE_CONFIG_INVALID" })
  })
})
