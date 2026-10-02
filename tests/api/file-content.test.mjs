import { createHash, randomBytes, randomUUID } from "node:crypto"
import { createServer, request as httpRequest } from "node:http"
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { GenericContainer, Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ApiErrorSchema } from "../../packages/contracts/src/index.ts"
import { createTenantRunner } from "../../packages/database/dist/tenant.js"
import { fileRepository } from "../../packages/database/dist/repositories/files.js"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { startTestApplication } from "../setup/test-runtime.mjs"

const require = createRequire(resolve("apps/api/package.json"))
const { FilesRuntime } = require("../../apps/api/dist/files/files-runtime.js")
const {
  TenantContextService,
} = require("../../apps/api/dist/tenancy/tenant-context.service.js")
const {
  RequestLanguage,
} = require("../../apps/api/dist/http/request-language.js")
const { storageKey } = require("../../apps/api/dist/files/storage/storage.js")
const {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3")
const versions = JSON.parse(
  await readFile("docs/architecture/versions.json", "utf8")
)
const origin = "http://localhost:3200"
const sha = (body) => createHash("sha256").update(body).digest("hex")
const chunks = async function* (body) {
  yield body
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5000
  do {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  } while (Date.now() < deadline)
  throw new Error("The expected resource state was not observed")
}

async function storageProxy(endpoint) {
  let pending
  let activeReads = 0
  const server = createServer((incoming, outgoing) => {
    const path = decodeURIComponent(incoming.url.split("?")[0])
    const hold =
      incoming.method === "GET" && pending?.path === path ? pending : undefined
    if (hold) pending = undefined
    const upstream = httpRequest(
      new URL(incoming.url, endpoint),
      {
        method: incoming.method,
        headers: incoming.headers,
      },
      async (source) => {
        if (incoming.method === "GET") {
          activeReads++
          source.once("close", () => activeReads--)
        }
        source.once("error", () => outgoing.destroy())
        if (hold?.mode === "headers") {
          hold.observed.resolve()
          await hold.release.promise
        }
        if (outgoing.destroyed) {
          source.destroy()
          return
        }
        outgoing.writeHead(source.statusCode, source.headers)
        if (hold?.mode === "body") {
          source.once("data", (chunk) => {
            source.pause()
            outgoing.write(chunk.subarray(0, 16))
            hold.observed.resolve()
          })
          hold.release.promise.then(() => {
            source.destroy()
            outgoing.destroy()
          })
        } else source.pipe(outgoing)
        outgoing.once("close", () => source.destroy())
      }
    )
    upstream.once("error", () => outgoing.destroy())
    outgoing.once("close", () => upstream.destroy())
    incoming.pipe(upstream)
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const deferred = () => {
    let done
    const promise = new Promise((resolve) => {
      done = resolve
    })
    return { promise, resolve: done }
  }
  return {
    endpoint: "http://127.0.0.1:" + server.address().port,
    activeReads: () => activeReads,
    hold(path, mode) {
      const observed = deferred()
      const release = deferred()
      pending = { path, mode, observed, release }
      return { observed: observed.promise, release: release.resolve }
    },
    async close() {
      pending?.release.resolve()
      server.closeAllConnections()
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    },
  }
}

const localServer = String.raw`
const { createApplication } = require('/app/apps/api/dist/create-application.js');
(async () => {
  const config = JSON.parse(process.env.CONTENT_TEST_CONFIG, (_, value) =>
    value?.type === 'Buffer' ? Buffer.from(value.data) : value);
  require('node:fs').mkdirSync(config.files.root, { mode: 0o700 });
  const app = await createApplication(config, { logger: ['error'] });
  await app.listen(3000, '0.0.0.0');
  console.log('CONTENT_HTTP_READY');
  process.once('SIGTERM', async () => { await app.close(); process.exit(0); });
})().catch((error) => { console.error(error.name + ': ' + error.message); process.exit(1); });
`
const localPhysical = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { createFileStorage, storageKey } = require('/app/apps/api/dist/files/storage/storage.js');
(async () => {
  const input = JSON.parse(process.argv[1]);
  if (input.action === 'handles') {
    const handles = fs.readdirSync('/proc/1/fd').filter((fd) => {
      try { return fs.readlinkSync('/proc/1/fd/' + fd).includes(input.config.root); }
      catch { return false; }
    });
    console.log(JSON.stringify(handles));
    return;
  }
  if (input.action === 'readAndTruncate') {
    const result = await new Promise((resolve, reject) => {
      require('node:http').get(input.url, { headers: input.headers }, (response) => {
        let receivedBytes = 0, truncated = false;
        const result = (terminated) => ({ status: response.statusCode,
          expectedBytes: Number(response.headers['content-length']), receivedBytes, terminated });
        response.on('data', (chunk) => {
          receivedBytes += chunk.length;
          if (!truncated) {
            // 在真实 HTTP 首字节后立即截断，避免跨虚拟机命令延迟把故障变成读完后的修改。
            truncated = true;
            fs.truncateSync(path.join(input.config.root, storageKey(input.address)), 0);
          }
        });
        response.once('end', () => resolve(result(false)));
        response.once('aborted', () => resolve(result(true)));
        response.once('error', () => resolve(result(true)));
      }).once('error', reject);
    });
    console.log(JSON.stringify(result));
    return;
  }
  const storage = await createFileStorage(input.config);
  try {
    let result = null;
    if (input.action === 'write') {
      const body = input.base64 === undefined ? Buffer.alloc(input.bytes, 97) : Buffer.from(input.base64, 'base64');
      result = await storage.write(input.address, (async function* () { yield body; })(), body.length);
    } else if (input.action === 'copy') {
      await storage.copy(input.address, input.target, input.facts);
    } else if (input.action === 'truncate') {
      fs.truncateSync(path.join(input.config.root, storageKey(input.address)), input.bytes);
    } else {
      await storage[input.action](input.address);
    }
    console.log(JSON.stringify(result));
  } finally { await storage[Symbol.asyncDispose](); }
})().catch((error) => { console.error('CONTENT_PHYSICAL_FAILED ' + (error.code ?? error.name)); process.exit(1); });
`

async function startBackend(kind, resources) {
  if (kind === "Local") {
    const environment = await startTestApplication({ origins: [origin] })
    resources.defer(() => environment.close())
    const config = { kind: "local", root: "/tmp/content-files-" + randomUUID() }
    const remoteHost = (value) => {
      const url = new URL(value)
      url.hostname = "host.docker.internal"
      return url.toString()
    }
    const applicationConfig = {
      ...environment.config,
      baseURL: "http://127.0.0.1:3000",
      databaseURL: remoteHost(environment.config.databaseURL),
      redisURL: remoteHost(environment.config.redisURL),
      files: config,
    }
    let startupLogs = ""
    const container = await new GenericContainer(versions.nodeImage)
      .withBindMounts([{ source: resolve("."), target: "/app", mode: "ro" }])
      .withWorkingDir("/app")
      .withEnvironment({
        CONTENT_TEST_CONFIG: JSON.stringify(applicationConfig),
      })
      .withCommand(["node", "-e", localServer])
      .withExposedPorts(3000)
      .withWaitStrategy(Wait.forLogMessage("CONTENT_HTTP_READY"))
      .withLogConsumer((stream) =>
        stream.on("data", (line) => {
          startupLogs += line.toString()
        })
      )
      .start()
      .catch((error) => {
        throw new Error("Linux production API startup failed: " + startupLogs, {
          cause: error,
        })
      })
    resources.defer(() => container.stop())
    const execute = async (input) => {
      const result = await container.exec([
        "node",
        "-e",
        localPhysical,
        JSON.stringify({ config, ...input }),
      ])
      expect(result.exitCode, result.output).toBe(0)
      return JSON.parse(result.output.trim())
    }
    return {
      ...environment,
      disabledBaseURL: environment.baseURL,
      baseURL:
        "http://" + container.getHost() + ":" + container.getMappedPort(3000),
      physical: {
        createDirectory: (address) =>
          execute({ action: "createDirectory", address }),
        write: (address, body) =>
          execute({
            action: "write",
            address,
            base64: body.toString("base64"),
          }),
        writeLarge: (address, bytes) =>
          execute({ action: "write", address, bytes }),
        copy: (address, target, facts) =>
          execute({ action: "copy", address, target, facts }),
        remove: (address) => execute({ action: "remove", address }),
        truncate: (address, bytes) =>
          execute({ action: "truncate", address, bytes }),
        handles: () => execute({ action: "handles" }),
        readAndTruncate: (address, url, headers) =>
          execute({
            action: "readAndTruncate",
            address,
            url: "http://127.0.0.1:3000" + new URL(url).pathname,
            headers,
          }),
      },
    }
  }
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
    .withStartupTimeout(120_000)
    .start()
  resources.defer(() => rustfs.stop())
  const endpoint =
    "http://" + rustfs.getHost() + ":" + rustfs.getMappedPort(9000)
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 1,
  })
  resources.defer(() => client.destroy())
  const bucket = "content-" + randomUUID()
  await client.send(new CreateBucketCommand({ Bucket: bucket }))
  const proxy = await storageProxy(endpoint)
  resources.defer(() => proxy.close())
  const config = {
    kind: "s3",
    endpoint: proxy.endpoint,
    region: "us-east-1",
    bucket,
    prefix: "content-suite",
    accessKeyId,
    secretAccessKey,
  }
  const environment = await startTestApplication({
    origins: [origin],
    files: config,
  })
  resources.defer(() => environment.close())
  const storage = environment.app.get(FilesRuntime).requireStorage()
  const key = (address) => config.prefix + "/" + storageKey(address)
  const physical = async (method, ...arguments_) => {
    try {
      return await storage[method](...arguments_)
    } catch (error) {
      // AWS 错误 cause 含签名请求；失败报告只保留正式错误码。
      throw new Error("Physical " + method + " failed: " + error.code)
    }
  }
  return {
    ...environment,
    proxy,
    proxyPath: (address) => "/" + bucket + "/" + key(address),
    physical: {
      createDirectory: (address) => physical("createDirectory", address),
      write: (address, body) =>
        physical("write", address, chunks(body), body.length),
      writeLarge: (address, bytes) =>
        physical("write", address, chunks(Buffer.alloc(bytes, 97)), bytes),
      copy: (address, target, facts) =>
        physical("copy", address, target, facts),
      remove: (address) => physical("remove", address),
      truncate: (address, bytes) =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key(address),
            Body: Buffer.alloc(bytes, 97),
          })
        ),
    },
  }
}

for (const kind of ["Local", "RustFS"]) {
  describe(kind + ": production protected file version content", () => {
    const resources = new AsyncDisposableStack()
    let environment,
      owner,
      member,
      custom,
      organization,
      otherOrganization,
      role
    const path = (fixture, org = organization) =>
      environment.baseURL +
      "/api/v1/organizations/" +
      org.id +
      "/files/entries/" +
      fixture.fileId +
      "/versions/" +
      fixture.versionId +
      "/content"
    const read = (
      fixture,
      actor = owner,
      headers = {},
      query = "",
      org = organization
    ) =>
      fetch(path(fixture, org) + query, {
        headers: { cookie: actor.cookie, origin, ...headers },
      })
    const context = (org = organization) =>
      environment.app
        .get(TenantContextService)
        .resolve(
          owner.headers,
          org.id,
          { file: ["read"] },
          randomUUID(),
          new RequestLanguage("zh-CN")
        )
    const run = (ctx, callback) =>
      createTenantRunner(environment.runtime.pool)(ctx, callback, "write")
    const begin = (tx, action, input) =>
      fileRepository.beginOperation(tx, {
        id: randomUUID(),
        action,
        input,
        requestHash: sha(JSON.stringify(input)),
        expiresAt: new Date(Date.now() + 86400000),
      })
    const address = (org, area, segments) => ({
      owner: { kind: "organization", id: org.id },
      area,
      segments,
    })
    const publish = async (
      name,
      body,
      contentType = "application/octet-stream",
      org = organization,
      largeBytes,
      parent
    ) => {
      const ctx = await context(org)
      const { root } = await run(ctx, (tx) =>
        fileRepository.ensureWorkspace(tx)
      )
      const folder = parent ?? root
      const target = address(org, "files", [...folder.path, name])
      const fileId = randomUUID(),
        versionId = randomUUID()
      const declaredBytes = largeBytes ?? body.length
      const prepared = await run(ctx, async (tx) => {
        const { operation } = await begin(tx, "upload", {
          name,
          declaredBytes,
          contentType,
        })
        await fileRepository.reserveUpload(tx, operation.id, {
          parentId: folder.id,
          name,
          declaredBytes,
        })
        const [object] = await fileRepository.addObjects(tx, operation.id, [
          {
            entryId: fileId,
            versionId,
            directory: false,
            targetArea: "files",
            targetPath: target.segments,
            expectedBytes: declaredBytes,
          },
        ])
        return { operation, object }
      })
      const facts =
        largeBytes === undefined
          ? await environment.physical.write(target, body)
          : await environment.physical.writeLarge(target, largeBytes)
      const entry = await run(ctx, async (tx) => {
        await fileRepository.recordPreparedObject(
          tx,
          prepared.operation.id,
          prepared.object.id,
          { ...facts, transientBytes: 0 }
        )
        const entry = await fileRepository.commitUpload(
          tx,
          prepared.operation.id,
          {
            fileId,
            versionId,
            objectId: prepared.object.id,
            parentId: folder.id,
            name,
            contentType,
          }
        )
        await fileRepository.finishOperation(
          tx,
          prepared.operation.id,
          new Date()
        )
        return entry
      })
      return {
        entry,
        fileId,
        versionId,
        address: target,
        context: ctx,
        operationId: prepared.operation.id,
        ...facts,
      }
    }
    const folderFixture = async (name, parent) => {
      const ctx = await context()
      const { root } = await run(ctx, (tx) =>
        fileRepository.ensureWorkspace(tx)
      )
      const parentFolder = parent ?? root
      const prepared = await run(ctx, async (tx) => {
        const { operation } = await begin(tx, "create-folder", {
          name,
          parentId: parentFolder.id,
        })
        const input = { id: randomUUID(), name, parentId: parentFolder.id }
        const plan = await fileRepository.prepareFolder(tx, operation.id, input)
        return { operation, input, ...plan }
      })
      await environment.physical.createDirectory(
        address(organization, "files", prepared.path)
      )
      return run(ctx, async (tx) => {
        for (const object of prepared.objects)
          await fileRepository.recordPreparedObject(
            tx,
            prepared.operation.id,
            object.id,
            { bytes: 0, sha256: null, transientBytes: 0 }
          )
        await fileRepository.commitFolder(
          tx,
          prepared.operation.id,
          prepared.input
        )
        await fileRepository.finishOperation(
          tx,
          prepared.operation.id,
          new Date()
        )
        return fileRepository.findEntry(tx, prepared.input.id)
      })
    }
    const readCatalog = (suffix, org = organization) =>
      fetch(
        environment.baseURL +
          "/api/v1/organizations/" +
          org.id +
          "/files" +
          suffix,
        { headers: { cookie: owner.cookie, origin } }
      )
    const prepareRename = async (fixture, name) =>
      run(fixture.context, async (tx) => {
        const { operation } = await begin(tx, "rename", {
          entryId: fixture.fileId,
          name,
        })
        const result = await fileRepository.preparePathOperation(
          tx,
          operation.id,
          {
            entryId: fixture.fileId,
            expectedRevision: fixture.entry.revision,
            name,
            now: new Date(),
          }
        )
        return { operation, ...result }
      })
    const finishRename = async (fixture, prepared) => {
      for (const object of prepared.objects) {
        const source = address(
          organization,
          object.sourceArea,
          object.sourcePath
        )
        const target = address(
          organization,
          object.targetArea,
          object.targetPath
        )
        await environment.physical.copy(source, target, {
          bytes: object.expectedBytes,
          sha256: object.expectedSha256,
        })
        await run(fixture.context, (tx) =>
          fileRepository.recordPreparedObject(
            tx,
            prepared.operation.id,
            object.id,
            {
              bytes: object.expectedBytes,
              sha256: object.expectedSha256,
              transientBytes: object.expectedBytes,
            }
          )
        )
      }
      await run(fixture.context, (tx) =>
        fileRepository.commitPathOperation(
          tx,
          prepared.operation.id,
          new Date()
        )
      )
      for (const object of prepared.objects) {
        await environment.physical.remove(
          address(organization, object.sourceArea, object.sourcePath)
        )
        await run(fixture.context, (tx) =>
          fileRepository.recordObjectDeleted(
            tx,
            prepared.operation.id,
            object.id,
            "source",
            new Date()
          )
        )
      }
      await run(fixture.context, (tx) =>
        fileRepository.finishOperation(tx, prepared.operation.id, new Date())
      )
    }
    const roleWrite = async (permission) => {
      const state = await environment.migrator.query(
        "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
        [organization.id]
      )
      const response = await fetch(
        environment.baseURL + "/api/auth/organization/update-role",
        {
          method: "POST",
          headers: {
            cookie: owner.cookie,
            origin,
            "content-type": "application/json",
            "X-Expected-Authz-Version": String(
              state.rows[0].authorization_version
            ),
          },
          body: JSON.stringify({
            organizationId: organization.id,
            roleId: role.id,
            data: { permission },
          }),
        }
      )
      expect(response.status).toBe(200)
    }
    const expectError = async (response, status, code) => {
      expect(response.status).toBe(status)
      const error = ApiErrorSchema.parse(await response.json())
      expect(error).toMatchObject({ code })
      expect(JSON.stringify(error)).not.toMatch(
        /storagePath|storageArea|content-suite|content-files-|locator/iu
      )
      return error
    }

    beforeAll(async () => {
      environment = await startBackend(kind, resources)
      owner = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      member = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      custom = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      organization = await environment.runtime.auth.api.createOrganization({
        headers: owner.headers,
        body: { name: "内容组织", slug: randomUUID() },
      })
      otherOrganization = await environment.runtime.auth.api.createOrganization(
        {
          headers: owner.headers,
          body: { name: "独立内容组织", slug: randomUUID() },
        }
      )
      for (const org of [organization, otherOrganization])
        await environment.physical.createDirectory(address(org, "files", []))
      role = (
        await environment.runtime.auth.api.createOrgRole({
          headers: owner.headers,
          body: {
            organizationId: organization.id,
            role: "content-custom",
            permission: { project: ["read"] },
          },
        })
      ).roleData
      for (const [actor, roleName] of [
        [member, "member"],
        [custom, "content-custom"],
      ])
        await environment.runtime.auth.api.addMember({
          headers: owner.headers,
          body: {
            organizationId: organization.id,
            userId: actor.user.id,
            role: roleName,
          },
        })
    })
    afterAll(() => resources.disposeAsync())

    it("reads one persistent workspace root, direct directory entries, scoped search and breadcrumbs through production routes", async () => {
      const first = await readCatalog("/workspace")
      const second = await readCatalog("/workspace")
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      const workspace = await first.json()
      expect((await second.json()).root.id).toBe(workspace.root.id)
      expect(workspace.root).toMatchObject({
        kind: "folder",
        parentId: null,
        path: [],
      })
      const folder = await folderFixture("catalog-folder")
      const nestedFolder = await folderFixture("nested-folder", folder)
      const direct = await publish(
        "catalog-needle-root.txt",
        Buffer.from("root"),
        "text/plain"
      )
      const nested = await publish(
        "catalog-needle-nested.txt",
        Buffer.from("nested"),
        "text/plain",
        organization,
        undefined,
        folder
      )
      const rootPage = await readCatalog("")
      expect(rootPage.status).toBe(200)
      const names = (await rootPage.json()).items.map((item) => item.name)
      expect(names).toContain("catalog-folder")
      expect(names).toContain("catalog-needle-root.txt")
      expect(names).not.toContain("catalog-needle-nested.txt")
      expect(names).not.toContain("nested-folder")
      const directory = await readCatalog("?parentId=" + folder.id)
      expect(directory.status).toBe(200)
      expect(
        (await directory.json()).items.map((item) => item.id).sort()
      ).toEqual([nestedFolder.id, nested.fileId].sort())
      const found = []
      for (const page of [1, 2]) {
        const response = await readCatalog(
          "?name=catalog-needle&pageSize=1&page=" + page
        )
        expect(response.status).toBe(200)
        const result = await response.json()
        expect(result).toMatchObject({ total: 2, page, pageSize: 1 })
        found.push(result.items[0].id)
      }
      expect(found).toEqual([nested.fileId, direct.fileId])
      const breadcrumbs = await readCatalog(
        "/folders/" + nestedFolder.id + "/breadcrumbs"
      )
      expect(breadcrumbs.status).toBe(200)
      expect((await breadcrumbs.json()).items.map((item) => item.id)).toEqual([
        workspace.root.id,
        folder.id,
        nestedFolder.id,
      ])
      await expectError(
        await readCatalog(
          "/folders/" + folder.id + "/breadcrumbs",
          otherOrganization
        ),
        404,
        "NOT_FOUND"
      )
    })

    it("projects fixed versions and safe operation receipts without internal plans or locations", async () => {
      const fixture = await publish(
        "catalog-metadata.txt",
        Buffer.from("fixed version"),
        "text/plain"
      )
      const response = await readCatalog("/entries/" + fixture.fileId)
      expect(response.status).toBe(200)
      const metadata = await response.json()
      expect(metadata).toMatchObject({
        kind: "file",
        id: fixture.fileId,
        currentVersion: {
          id: fixture.versionId,
          fileId: fixture.fileId,
          bytes: fixture.bytes,
          sha256: fixture.sha256,
          isCurrent: true,
        },
      })
      const versions = await readCatalog(
        "/entries/" + fixture.fileId + "/versions"
      )
      expect(versions.status).toBe(200)
      expect((await versions.json()).items).toEqual([metadata.currentVersion])
      const operation = await readCatalog("/operations/" + fixture.operationId)
      expect(operation.status).toBe(200)
      const receipt = await operation.json()
      expect(receipt).toMatchObject({
        id: fixture.operationId,
        action: "upload",
        phase: "completed",
        result: {
          entryId: fixture.fileId,
          versionId: fixture.versionId,
          revision: 1,
        },
      })
      expect(JSON.stringify([metadata, receipt])).not.toMatch(
        /storagePath|storageArea|requestHash|locator|content-suite|content-files-/iu
      )
      for (const key of ["input", "plans", "objects", "actorId", "leaseId"])
        expect(receipt).not.toHaveProperty(key)
      await expectError(
        await readCatalog("/entries/" + fixture.fileId, otherOrganization),
        404,
        "NOT_FOUND"
      )
      await expectError(
        await readCatalog(
          "/entries/" + fixture.fileId + "/versions",
          otherOrganization
        ),
        404,
        "NOT_FOUND"
      )
      await expectError(
        await readCatalog(
          "/operations/" + fixture.operationId,
          otherOrganization
        ),
        404,
        "NOT_FOUND"
      )
    })

    if (kind === "Local")
      it("returns a formal 404 when the registered feature has no configured storage", async () => {
        const fixture = await publish("disabled.bin", Buffer.from("disabled"))
        await expectError(
          await fetch(
            environment.disabledBaseURL + new URL(path(fixture)).pathname,
            { headers: { cookie: owner.cookie, origin } }
          ),
          404,
          "NOT_FOUND"
        )
      })

    it("serves original binary bytes with Chinese RFC5987 download headers and private security headers", async () => {
      const body = Buffer.from([0, 255, 128, 13, 10, 1])
      const fixture = await publish("中文 合同 50%.bin", body)
      const response = await read(fixture, member)
      expect(response.status).toBe(200)
      expect(response.headers.get("content-length")).toBe(String(body.length))
      expect(response.headers.get("content-disposition")).toBe(
        "attachment; filename*=UTF-8''" +
          encodeURIComponent("中文 合同 50%.bin")
      )
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("accept-ranges")).toBe("bytes")
      expect(Buffer.from(await response.arrayBuffer())).toEqual(body)
    })

    it.each([
      ['report "draft".txt', 'attachment; filename="report \\"draft\\".txt"'],
      [
        "计划 (v2)'报告.txt",
        "attachment; filename*=UTF-8''%E8%AE%A1%E5%88%92%20%28v2%29%27%E6%8A%A5%E5%91%8A.txt",
      ],
    ])(
      "preserves the download name %s using standard header encoding",
      async (name, disposition) => {
        const body = Buffer.from("original download bytes")
        const fixture = await publish(name, body)
        const response = await read(fixture)
        expect(response.status).toBe(200)
        expect(response.headers.get("content-disposition")).toBe(disposition)
        expect(Buffer.from(await response.arrayBuffer())).toEqual(body)
      }
    )

    it.each([
      ["json.json", Buffer.from(' { "file": true } \r\n'), "application/json"],
      [
        "text.txt",
        Buffer.from("原始文字\r\n\u0000"),
        "text/plain; charset=utf-8",
      ],
      ["empty.bin", Buffer.alloc(0), "application/octet-stream"],
    ])(
      "keeps %s byte-for-byte including zero-length content",
      async (name, body, mime) => {
        const fixture = await publish(name, body, mime)
        const response = await read(fixture)
        expect(response.status).toBe(200)
        expect(response.headers.get("content-length")).toBe(String(body.length))
        expect(response.headers.get("content-type")).toBe(mime)
        expect(Buffer.from(await response.arrayBuffer())).toEqual(body)
      }
    )

    it("supports bounded, open-ended and suffix single ranges with exact partial bytes", async () => {
      const body = Buffer.from([0, 255, 4, 8, 16, 32, 64, 128])
      const fixture = await publish("ranges.bin", body)
      for (const [range, start, end] of [
        ["bytes=1-3", 1, 3],
        ["bytes=5-", 5, 7],
        ["bytes=-2", 6, 7],
        ["bytes=6-99", 6, 7],
        ["bytes=-99", 0, 7],
        ["BYTES=0001-0003", 1, 3],
      ]) {
        const response = await read(fixture, owner, { range })
        expect(response.status).toBe(206)
        expect(response.headers.get("content-range")).toBe(
          "bytes " + start + "-" + end + "/" + body.length
        )
        expect(response.headers.get("content-length")).toBe(
          String(end - start + 1)
        )
        expect(Buffer.from(await response.arrayBuffer())).toEqual(
          body.subarray(start, end + 1)
        )
      }
      for (const range of [
        "bytes=8-",
        "bytes=3-1",
        "bytes=-0",
        "bytes=0-1,3-4",
        "bytes=0-3,2-5",
        "bytes=0-7,9-10",
        "bytes=1.5-3",
        "bytes=1-3tail",
        "bytes=+1-3",
        "items=0-1",
        "bytes=-",
        "bytes=9007199254740992-",
        "bytes=0-9007199254740992",
        "bytes=-9007199254740992",
      ]) {
        const response = await read(fixture, owner, { range })
        expect(response.headers.get("content-range")).toBe("bytes */8")
        await expectError(response, 416, "FILE_RANGE_INVALID")
      }
      const empty = await publish("empty-range.bin", Buffer.alloc(0))
      const invalid = await read(empty, owner, { range: "bytes=0-" })
      expect(invalid.headers.get("content-range")).toBe("bytes */0")
      await expectError(invalid, 416, "FILE_RANGE_INVALID")
    })

    it("allows supported inline content and rejects execution-capable or unsupported formats explicitly", async () => {
      const text = await publish(
        "inline.txt",
        Buffer.from("<script>inert text</script>"),
        "text/plain"
      )
      const response = await read(text, owner, {}, "?disposition=inline")
      expect(response.status).toBe(200)
      expect(response.headers.get("content-disposition")).toMatch(/^inline;/u)
      expect(await response.text()).toBe("<script>inert text</script>")
      for (const [name, mime] of [
        ["page.html", "text/html"],
        ["vector.svg", "image/svg+xml"],
        [
          "document.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
      ]) {
        const body = Buffer.from("download-only")
        const fixture = await publish(name, body, mime)
        await expectError(
          await read(fixture, owner, {}, "?disposition=inline"),
          400,
          "VALIDATION_ERROR"
        )
        const download = await read(fixture)
        expect(download.status).toBe(200)
        expect(download.headers.get("content-disposition")).toMatch(
          /^attachment;/u
        )
        expect(Buffer.from(await download.arrayBuffer())).toEqual(body)
      }
      await expectError(
        await read(text, owner, {}, "?disposition=execute"),
        400,
        "VALIDATION_ERROR"
      )
    })

    it("enforces identity, organization scope, missing version and explicit custom-role read grants", async () => {
      const fixture = await publish("authorization.bin", Buffer.from("private"))
      await expectError(await fetch(path(fixture)), 401, "UNAUTHENTICATED")
      const foreign = await publish(
        "foreign.bin",
        Buffer.from("foreign"),
        "application/octet-stream",
        otherOrganization
      )
      await expectError(await read(foreign), 404, "NOT_FOUND")
      await expectError(
        await read(foreign, member, {}, "", otherOrganization),
        403,
        "FORBIDDEN"
      )
      await expectError(
        await read({ ...fixture, versionId: randomUUID() }),
        404,
        "NOT_FOUND"
      )
      await expectError(
        await read({ ...fixture, fileId: randomUUID() }),
        404,
        "NOT_FOUND"
      )
      await expectError(await read(fixture, custom), 403, "FORBIDDEN")
      await roleWrite({ project: ["read"], file: ["read"] })
      const granted = await read(fixture, custom)
      expect(granted.status).toBe(200)
      expect(await granted.text()).toBe("private")
      await roleWrite({ project: ["read"] })
      await expectError(await read(fixture, custom), 403, "FORBIDDEN")
      const state = await environment.migrator.query(
        "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
        [organization.id]
      )
      const removed = await fetch(
        environment.baseURL + "/api/auth/organization/remove-member",
        {
          method: "POST",
          headers: {
            cookie: owner.cookie,
            origin,
            "content-type": "application/json",
            "X-Expected-Authz-Version": String(
              state.rows[0].authorization_version
            ),
          },
          body: JSON.stringify({
            organizationId: organization.id,
            memberIdOrEmail: member.user.email,
          }),
        }
      )
      expect(removed.status).toBe(200)
      await expectError(await read(fixture, member), 403, "FORBIDDEN")
    })

    it("returns a safe operation conflict while the published file is reserved by a real operation", async () => {
      const fixture = await publish("busy.bin", Buffer.from("busy"))
      const prepared = await prepareRename(fixture, "busy-renamed.bin")
      const error = await expectError(
        await read(fixture),
        409,
        "FILE_OPERATION_IN_PROGRESS"
      )
      expect(error.details).toEqual({ operationId: prepared.operation.id })
    })

    it("reports absent and mismatched physical content without disclosing internal locators", async () => {
      const absent = await publish("absent.bin", Buffer.from("gone"))
      await environment.physical.remove(absent.address)
      await expectError(await read(absent), 404, "NOT_FOUND")
      const mismatch = await publish(
        "mismatch.bin",
        Buffer.from("expected-length")
      )
      await environment.physical.truncate(mismatch.address, 1)
      await expectError(await read(mismatch), 503, "FILE_STORAGE_UNAVAILABLE")
    })

    it("retains the opened source stream across a real copy, metadata publication and source cleanup", async () => {
      const fixture = await publish(
        "cleanup.bin",
        null,
        "application/octet-stream",
        organization,
        8 * 1024 * 1024
      )
      const response = await read(fixture)
      expect(response.status).toBe(200)
      const prepared = await prepareRename(fixture, "cleanup-renamed.bin")
      await finishRename(fixture, prepared)
      const body = Buffer.from(await response.arrayBuffer())
      expect(body.length).toBe(fixture.bytes)
      expect(sha(body)).toBe(fixture.sha256)
      const renamed = await read(fixture)
      expect(renamed.status).toBe(200)
      expect(renamed.headers.get("content-disposition")).toContain(
        "cleanup-renamed.bin"
      )
      expect(sha(Buffer.from(await renamed.arrayBuffer()))).toBe(fixture.sha256)
    })

    it("does not complete a truncated stream as a successful empty or partial file", async () => {
      const fixture = await publish(
        "stream-failure.bin",
        null,
        "application/octet-stream",
        organization,
        8 * 1024 * 1024
      )
      if (environment.physical.readAndTruncate) {
        const result = await environment.physical.readAndTruncate(
          fixture.address,
          path(fixture),
          { cookie: owner.cookie, origin }
        )
        expect(result.status).toBe(200)
        expect(result.expectedBytes).toBe(fixture.bytes)
        expect(result.receivedBytes).toBeGreaterThan(0)
        expect(result.receivedBytes).toBeLessThan(fixture.bytes)
        expect(result.terminated).toBe(true)
        return
      }
      let barrier
      if (environment.proxy)
        barrier = environment.proxy.hold(
          environment.proxyPath(fixture.address),
          "body"
        )
      try {
        const response = await read(fixture)
        expect(response.status).toBe(200)
        if (barrier) {
          await barrier.observed
          barrier.release()
        }
        const failed = await response.arrayBuffer().then(
          () => false,
          () => true
        )
        expect(failed).toBe(true)
      } finally {
        barrier?.release()
      }
    })

    it("releases the actual local descriptor or upstream body after the client aborts", async () => {
      const fixture = await publish(
        "abort.bin",
        null,
        "application/octet-stream",
        organization,
        8 * 1024 * 1024
      )
      const controller = new AbortController()
      const response = await fetch(path(fixture), {
        headers: { cookie: owner.cookie, origin },
        signal: controller.signal,
      })
      const reader = response.body.getReader()
      expect((await reader.read()).done).toBe(false)
      controller.abort()
      await expect(reader.read()).rejects.toThrow()
      if (environment.physical.handles)
        await waitFor(
          async () => (await environment.physical.handles()).length === 0
        )
      else await waitFor(() => environment.proxy.activeReads() === 0)
    })

    if (kind === "RustFS")
      it("releases the actual object body after disconnecting while GetObject is still opening", async () => {
        const fixture = await publish(
          "abort-opening.bin",
          null,
          "application/octet-stream",
          organization,
          8 * 1024 * 1024
        )
        const barrier = environment.proxy.hold(
          environment.proxyPath(fixture.address),
          "headers"
        )
        const controller = new AbortController()
        try {
          const requested = fetch(path(fixture), {
            headers: { cookie: owner.cookie, origin },
            signal: controller.signal,
          }).then(
            () => false,
            () => true
          )
          await barrier.observed
          controller.abort()
          expect(await requested).toBe(true)
          barrier.release()
          await waitFor(() => environment.proxy.activeReads() === 0)
        } finally {
          barrier.release()
        }
      })

    if (kind === "RustFS")
      it("holds version and entry share locks until the real GetObject opens, blocking source cleanup", async () => {
        const fixture = await publish(
          "open-lock.bin",
          Buffer.from("source held until GetObject opens")
        )
        const barrier = environment.proxy.hold(
          environment.proxyPath(fixture.address),
          "headers"
        )
        try {
          const responsePromise = read(fixture)
          await barrier.observed
          let completed = false
          const cleanup = prepareRename(fixture, "open-lock-renamed.bin").then(
            (result) => {
              completed = true
              return result
            }
          )
          await waitFor(async () => {
            const result = await environment.migrator.query(
              "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0"
            )
            return result.rows[0].waiting > 0
          })
          expect(completed).toBe(false)
          barrier.release()
          const response = await responsePromise
          expect(response.status).toBe(200)
          await finishRename(fixture, await cleanup)
          expect(await response.text()).toBe(
            "source held until GetObject opens"
          )
        } finally {
          barrier.release()
        }
      })

    it("rejects the same authenticated cookie after organization suspension", async () => {
      const fixture = await publish(
        "suspension.bin",
        Buffer.from("active only")
      )
      const administrator = await platformOperator(environment, origin)
      const suspended = await fetch(
        environment.baseURL +
          "/api/v1/platform/organizations/" +
          organization.id +
          "/suspend",
        {
          method: "POST",
          headers: {
            cookie: administrator.cookie,
            origin,
            "content-type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({
            expectedVersion: 1,
            reason: "Protected content must follow organization status",
          }),
        }
      )
      expect(suspended.status).toBe(200)
      await expectError(await read(fixture), 403, "ORGANIZATION_SUSPENDED")
    })
  })
}
