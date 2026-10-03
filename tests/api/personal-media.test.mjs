import { containerHostURL } from "../setup/container-host.mjs"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { createServer, request as httpRequest } from "node:http"
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { GenericContainer, Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  PersonalMediaUploadResultSchema,
  PersonalAvatarResultSchema,
  ApiErrorSchema,
} from "../../packages/contracts/src/index.ts"
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
    const selected =
      pending &&
      (pending.method ?? "GET") === incoming.method &&
      (pending.path === path ||
        (pending.path === undefined && /\/files\/[0-9a-f-]{36}$/.test(path)))
    const hold = selected ? pending : undefined
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
    hold(path, mode, method = "GET") {
      const observed = deferred()
      const release = deferred()
      pending = { path, mode, method, observed, release }
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
  const config = JSON.parse(process.env.PERSONAL_TEST_CONFIG, (_, value) =>
    value?.type === 'Buffer' ? Buffer.from(value.data) : value);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
    if ((url.hostname === 'github.com' && url.pathname === '/login/oauth/access_token') ||
      (url.hostname === 'api.github.com' && ['/user','/user/emails'].includes(url.pathname)))
      return nativeFetch(new URL(url.pathname, config.oauthProbe), init);
    return nativeFetch(input, init);
  };
  require('node:fs').mkdirSync(config.files.root, { mode: 0o700 });
  const app = await createApplication(config, { logger: ['error'] });
  await app.listen(3000, '0.0.0.0');
  console.log('PERSONAL_HTTP_READY');
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
  const oauthProfile = {
    id: Math.floor(Math.random() * 1_000_000_000),
    login: "personal-oauth",
    name: "OAuth first account",
    email: randomUUID() + "@example.test",
    avatar_url: "https://external.example/oauth-image.png",
  }
  const oauth = createServer((request, response) => {
    request.resume()
    response.setHeader("Content-Type", "application/json")
    const data =
      request.url === "/login/oauth/access_token"
        ? {
            access_token: "personal-test-token",
            token_type: "bearer",
            scope: "read:user user:email",
          }
        : request.url === "/user/emails"
          ? [{ email: oauthProfile.email, primary: true, verified: true }]
          : oauthProfile
    response.end(JSON.stringify(data))
  })
  await new Promise((resolve) => oauth.listen(0, "0.0.0.0", resolve))
  resources.defer(async () => {
    oauth.closeAllConnections()
    await new Promise((resolve) => oauth.close(resolve))
  })
  const oauthProbe = "http://127.0.0.1:" + oauth.address().port
  if (kind === "Local") {
    const environment = await startTestApplication({ origins: [origin] })
    resources.defer(() => environment.close())
    const config = {
      kind: "local",
      root: "/tmp/personal-files-" + randomUUID(),
    }
    const applicationConfig = {
      ...environment.config,
      baseURL: "http://127.0.0.1:3000",
      databaseURL: await containerHostURL(environment.config.databaseURL),
      redisURL: await containerHostURL(environment.config.redisURL),
      files: config,
      oauthProbe: await containerHostURL(oauthProbe),
    }
    let startupLogs = ""
    const container = await new GenericContainer(versions.nodeImage)
      .withBindMounts([{ source: resolve("."), target: "/app", mode: "ro" }])
      .withWorkingDir("/app")
      .withEnvironment({
        PERSONAL_TEST_CONFIG: JSON.stringify(applicationConfig),
      })
      .withCommand(["node", "-e", localServer])
      .withExposedPorts(3000)
      .withWaitStrategy(Wait.forLogMessage("PERSONAL_HTTP_READY"))
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
      oauthProfile,
      oauthProbe,
      logs: () => startupLogs,
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
    oauthProfile,
    oauthProbe,
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

const sharp = require("sharp")
const images = Object.fromEntries(
  await Promise.all(
    ["jpeg", "png", "webp", "gif"].map(async (format) => [
      format,
      await sharp({
        create: { width: 4, height: 4, channels: 3, background: "#05a1ff" },
      })
        [format]()
        .toBuffer(),
    ])
  )
)

describe.each(["Local", "RustFS"])(
  "personal media production HTTP: %s",
  (backend) => {
    let resources, environment, owner, viewer, organization
    const api = (path) => environment.baseURL + "/api/v1/personal-media" + path
    const upload = (
      body = images.png,
      mime = "image/png",
      actor = owner,
      key = randomUUID()
    ) =>
      fetch(api(""), {
        method: "POST",
        headers: {
          cookie: actor.cookie,
          origin,
          "content-type": mime,
          "Idempotency-Key": key,
        },
        body,
      })
    const save = (
      mediaId,
      expectedImage = null,
      actor = owner,
      key = randomUUID()
    ) =>
      fetch(api("/avatar"), {
        method: "PUT",
        headers: {
          cookie: actor.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ mediaId, expectedImage, idempotencyKey: key }),
      })
    const read = (mediaId, actor = owner, org) =>
      fetch(
        api("/" + mediaId + "/content") + (org ? "?organizationId=" + org : ""),
        {
          headers: { cookie: actor.cookie, origin },
        }
      )
    const uploaded = async (
      body = images.png,
      mime = "image/png",
      actor = owner,
      key = randomUUID()
    ) => {
      const response = await upload(body, mime, actor, key)
      expect(response.status, await response.clone().text()).toBe(201)
      return PersonalMediaUploadResultSchema.parse(await response.json())
    }
    const error = async (response, status, code) => {
      expect(response.status, await response.clone().text()).toBe(status)
      const result = ApiErrorSchema.parse(await response.json())
      expect(result.code).toBe(code)
      return result
    }
    const observe = (sql) => environment.observer.query(sql)
    beforeAll(async () => {
      resources = new AsyncDisposableStack()
      environment = await startBackend(backend, resources)
      owner = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      viewer = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      const response = await fetch(
        environment.baseURL + "/api/auth/organization/create",
        {
          method: "POST",
          headers: {
            cookie: owner.cookie,
            origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Personal media access",
            slug: "personal-" + randomUUID(),
          }),
        }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      organization = await response.json()
      await environment.migrator.query(
        "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ($1,$2,$3,'member',now())",
        [randomUUID(), organization.id, viewer.user.id]
      )
    }, 120_000)
    afterAll(async () => resources?.disposeAsync())

    it.each(["jpeg", "png", "webp", "gif"])(
      "decodes %s and reads the exact uploaded bytes",
      async (format) => {
        const mime = format === "jpeg" ? "image/jpeg" : "image/" + format
        const result = await uploaded(images[format], mime)
        expect(result.media.contentType).toBe(mime)
        expect(result.media.bytes).toBe(images[format].length)
        expect(Object.keys(result.media).sort()).toEqual(
          [
            "bytes",
            "contentType",
            "contentUrl",
            "createdAt",
            "expiresAt",
            "id",
          ].sort()
        )
        const response = await read(result.media.id)
        expect(response.status).toBe(200)
        expect(response.headers.get("content-type")).toBe(mime)
        expect(response.headers.get("content-length")).toBe(
          String(images[format].length)
        )
        expect(response.headers.get("content-disposition")).toBe("inline")
        expect(response.headers.get("cache-control")).toBe("private, no-store")
        expect(response.headers.get("x-content-type-options")).toBe("nosniff")
        expect(Buffer.from(await response.arrayBuffer())).toEqual(
          images[format]
        )
        await error(
          await read(result.media.id, viewer, organization.id),
          404,
          "NOT_FOUND"
        )
      }
    )

    it("rejects magic-only, truncated, mismatched MIME, empty and unsupported images before durable planning", async () => {
      const before = await observe(
        "SELECT count(*)::int AS count FROM personal_media_operations"
      )
      for (const [body, mime] of [
        [images.png.subarray(0, 33), "image/png"],
        [images.jpeg, "image/png"],
        [Buffer.alloc(0), "image/png"],
        [Buffer.from("<svg></svg>"), "image/svg+xml"],
        [images.jpeg.subarray(0, images.jpeg.length - 20), "image/jpeg"],
      ])
        await error(await upload(body, mime), 400, "VALIDATION_ERROR")
      const after = await observe(
        "SELECT count(*)::int AS count FROM personal_media_operations"
      )
      expect(after.rows).toEqual(before.rows)
    })

    it("accepts exactly 5 MiB and rejects one extra byte", async () => {
      const body = Buffer.alloc(5 * 1024 * 1024)
      images.png.copy(body)
      const result = await uploaded(body)
      const received = Buffer.from(
        await (await read(result.media.id)).arrayBuffer()
      )
      expect(received.length).toBe(body.length)
      expect(sha(received)).toBe(sha(body))
      const resultError = await error(
        await upload(Buffer.concat([body, Buffer.from([0])])),
        413,
        "FILE_TOO_LARGE"
      )
      expect(resultError.details).toEqual({ maximumBytes: 5 * 1024 * 1024 })
    })

    it("requires current identity, trusted Origin and a UUID upload key", async () => {
      await error(
        await fetch(api(""), {
          method: "POST",
          headers: {
            origin,
            "content-type": "image/png",
            "Idempotency-Key": randomUUID(),
          },
          body: images.png,
        }),
        401,
        "UNAUTHENTICATED"
      )
      await error(
        await fetch(api(""), {
          method: "POST",
          headers: {
            cookie: owner.cookie,
            origin: "https://other.example",
            "content-type": "image/png",
            "Idempotency-Key": randomUUID(),
          },
          body: images.png,
        }),
        403,
        "FORBIDDEN"
      )
      await error(
        await upload(images.png, "image/png", owner, "not-a-uuid"),
        400,
        "VALIDATION_ERROR"
      )
      await error(await read(randomUUID()), 404, "NOT_FOUND")
    })

    it("replays completed uploads without another object write and rejects a changed body", async () => {
      const key = randomUUID()
      const first = await uploaded(images.png, "image/png", owner, key)
      const second = await uploaded(images.png, "image/png", owner, key)
      expect(second).toEqual(first)
      await error(
        await upload(images.jpeg, "image/jpeg", owner, key),
        409,
        "IDEMPOTENCY_KEY_REUSED"
      )
      const audit = await observe(
        "SELECT count(*)::int AS count FROM audit_events WHERE event_code='personal_media.uploaded' AND resource_id='" +
          first.media.id +
          "'"
      )
      expect(audit.rows[0].count).toBe(1)
    })

    it("saves/removes User.image with CAS and receipts, and refreshes the native identity result", async () => {
      const actor = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      const media = await uploaded(images.png, "image/png", actor)
      const key = randomUUID()
      const first = await save(media.media.id, null, actor, key)
      expect(first.status, await first.clone().text()).toBe(200)
      const receipt = PersonalAvatarResultSchema.parse(await first.json())
      expect(receipt).toMatchObject({
        image: media.media.contentUrl,
        changed: true,
        result: "succeeded",
      })
      const replay = await save(media.media.id, null, actor, key)
      expect(await replay.json()).toEqual(receipt)
      const current = await fetch(
        environment.baseURL + "/api/auth/get-session",
        { headers: { cookie: actor.cookie, origin } }
      )
      expect((await current.json()).user.image).toBe(media.media.contentUrl)
      await error(await save(null, null, actor), 409, "VERSION_CONFLICT")
      const noChange = await save(media.media.id, receipt.image, actor)
      expect(await noChange.json()).toMatchObject({
        changed: false,
        result: "no_change",
      })
      const remove = await save(null, receipt.image, actor)
      expect(await remove.json()).toMatchObject({
        image: null,
        changed: true,
        result: "succeeded",
      })
      const after = await fetch(environment.baseURL + "/api/auth/get-session", {
        headers: { cookie: actor.cookie, origin },
      })
      expect((await after.json()).user.image).toBeNull()
      const reference = await environment.migrator.query(
        'SELECT image FROM public."user" WHERE id=$1',
        [actor.user.id]
      )
      expect(reference.rows[0].image).toBeNull()
    })

    it("shares only the current avatar in an explicit active organization and stops after revocation", async () => {
      const result = await uploaded()
      const saved = await save(result.media.id)
      expect(saved.status).toBe(200)
      await error(await read(result.media.id, viewer), 404, "NOT_FOUND")
      await error(
        await read(result.media.id, viewer, randomUUID()),
        404,
        "NOT_FOUND"
      )
      expect(
        (await read(result.media.id, viewer, organization.id)).status
      ).toBe(200)
      const roleId = randomUUID()
      await environment.migrator.query(
        "INSERT INTO organization_role (id, organization_id, role, permission, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())",
        [roleId, organization.id, "restricted", "{}"]
      )
      await environment.migrator.query(
        "UPDATE member SET role=$1 WHERE user_id=$2 AND organization_id=$3",
        ["restricted", viewer.user.id, organization.id]
      )
      await error(
        await read(result.media.id, viewer, organization.id),
        404,
        "NOT_FOUND"
      )
      await environment.migrator.query(
        "UPDATE organization_role SET permission=$1 WHERE id=$2",
        [JSON.stringify({ member: ["read"] }), roleId]
      )
      expect(
        (await read(result.media.id, viewer, organization.id)).status
      ).toBe(200)
      await environment.migrator.query(
        "UPDATE organization_role SET permission=$1 WHERE id=$2",
        ["{}", roleId]
      )
      await error(
        await read(result.media.id, viewer, organization.id),
        404,
        "NOT_FOUND"
      )
      await environment.migrator.query(
        "UPDATE member SET role=$1 WHERE user_id=$2 AND organization_id=$3",
        ["member", viewer.user.id, organization.id]
      )
      const remove = await save(null, result.media.contentUrl)
      expect(remove.status).toBe(200)
      await error(
        await read(result.media.id, viewer, organization.id),
        404,
        "NOT_FOUND"
      )
    })

    it("rejects native arbitrary avatar updates while nickname and preference behavior stay intact", async () => {
      const before = await environment.migrator.query(
        'SELECT image FROM public."user" WHERE id=$1',
        [owner.user.id]
      )
      const response = await fetch(
        environment.baseURL + "/api/auth/update-user",
        {
          method: "POST",
          headers: {
            cookie: owner.cookie,
            origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            image: "https://external.example/avatar.png",
          }),
        }
      )
      expect(response.status, await response.clone().text()).toBe(400)
      expect((await response.json()).code).toBe("VALIDATION_ERROR")
      const name = await fetch(environment.baseURL + "/api/auth/update-user", {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "New name" }),
      })
      expect(name.status, await name.clone().text()).toBe(200)
      const result = await environment.migrator.query(
        'SELECT name, image, preferred_locale FROM public."user" WHERE id=$1',
        [owner.user.id]
      )
      expect(result.rows[0]).toEqual({
        name: "New name",
        image: before.rows[0].image,
        preferred_locale: null,
      })
    })
    it("keeps decoded animation bytes and rejects malformed pixel data", async () => {
      const animated = await sharp(
        Buffer.from(
          Array.from({ length: 4 * 8 * 3 }, (_, index) => (index * 31) % 256)
        ),
        {
          raw: { width: 4, height: 8, channels: 3, pageHeight: 4 },
        }
      )
        .gif()
        .toBuffer()
      expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(
        2
      )
      const result = await uploaded(animated, "image/gif")
      expect(
        Buffer.from(await (await read(result.media.id)).arrayBuffer())
      ).toEqual(animated)
      await error(
        await upload(images.png.subarray(0, images.png.length - 15)),
        400,
        "VALIDATION_ERROR"
      )
    })

    it("rejects stale Session snapshots for upload, save and content", async () => {
      const actor = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      const result = await uploaded(images.png, "image/png", actor)
      await environment.migrator.query(
        "DELETE FROM public.session WHERE user_id=$1",
        [actor.user.id]
      )
      await error(
        await upload(images.png, "image/png", actor),
        401,
        "UNAUTHENTICATED"
      )
      await error(
        await save(result.media.id, null, actor),
        401,
        "UNAUTHENTICATED"
      )
      await error(await read(result.media.id, actor), 401, "UNAUTHENTICATED")
    })

    it("serializes competing avatar CAS and never deletes the already published loser", async () => {
      const actor = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      const a = await uploaded(images.png, "image/png", actor),
        b = await uploaded(images.jpeg, "image/jpeg", actor)
      const responses = await Promise.all([
        save(a.media.id, null, actor),
        save(b.media.id, null, actor),
      ])
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ])
      const winner = await responses
        .find((response) => response.status === 200)
        .json()
      await error(
        responses.find((response) => response.status === 409),
        409,
        "VERSION_CONFLICT"
      )
      const current = await fetch(
        environment.baseURL + "/api/auth/get-session",
        { headers: { cookie: actor.cookie, origin } }
      )
      expect((await current.json()).user.image).toBe(winner.image)
      expect((await read(a.media.id, actor)).status).toBe(200)
      expect((await read(b.media.id, actor)).status).toBe(200)
      const candidates = await environment.runtime.pool.query(
        "SELECT public.get_personal_media_maintenance_candidates(100) AS result"
      )
      expect(
        candidates.rows[0].result.some((job) => job.userId === actor.user.id)
      ).toBe(false)
      await error(await save(a.media.id, null, viewer), 404, "NOT_FOUND")
    })

    it("keeps upload publication and private audit atomic and hands a known failure to exact maintenance", async () => {
      const key = randomUUID()
      await environment.migrator
        .query(`CREATE FUNCTION public.personal_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN IF NEW.event_code='personal_media.uploaded' THEN RAISE EXCEPTION 'test injected audit failure'; END IF; RETURN NEW; END; $f$;
      CREATE TRIGGER personal_test_audit_failure BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.personal_test_audit_failure();`)
      try {
        await error(
          await upload(images.png, "image/png", owner, key),
          503,
          "AUDIT_UNAVAILABLE"
        )
        const facts = await observe(
          "SELECT id,media_id,phase,error_code,lease_id FROM personal_media_operations WHERE user_id='" +
            owner.user.id +
            "' AND id='" +
            key +
            "'"
        )
        expect(facts.rows[0]).toMatchObject({
          id: key,
          phase: "preparing",
          error_code: "AUDIT_UNAVAILABLE",
        })
        const media = await observe(
          "SELECT id FROM personal_media WHERE operation_id='" + key + "'"
        )
        expect(media.rows).toEqual([])
        const candidates = await environment.runtime.pool.query(
          "SELECT public.get_personal_media_maintenance_candidates(100) AS result"
        )
        expect(candidates.rows[0].result).toContainEqual({
          userId: owner.user.id,
          kind: "upload",
          id: key,
        })
        await error(
          await upload(images.png, "image/png", owner, key),
          409,
          "FILE_OPERATION_IN_PROGRESS"
        )
      } finally {
        await environment.migrator.query(
          "DROP TRIGGER personal_test_audit_failure ON public.audit_events; DROP FUNCTION public.personal_test_audit_failure()"
        )
      }
    })

    it("reports absent and mismatched physical media with safe formal errors", async () => {
      const a = await uploaded(),
        b = await uploaded()
      const address = (id) => ({
        owner: { kind: "personal", id: owner.user.id },
        area: "files",
        segments: [id],
      })
      await environment.physical.remove(address(a.media.id))
      await error(await read(a.media.id), 404, "NOT_FOUND")
      await environment.physical.truncate(address(b.media.id), 1)
      const result = await error(
        await read(b.media.id),
        503,
        "FILE_STORAGE_UNAVAILABLE"
      )
      expect(Object.keys(result)).toEqual([
        "code",
        "message",
        "requestId",
        "locale",
      ])
    })

    it("keeps native permission rechecks read-only while publication holds the current Session share lock", async () => {
      const result = await environment.observer.query(
        "SELECT id,token FROM session WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [owner.user.id]
      )
      const context = await environment.runtime.auth.$context
      await context.internalAdapter.updateSession(result.rows[0].token, {
        updatedAt: new Date(Date.now() - 3 * 86400000),
        expiresAt: new Date(Date.now() + 86400000),
      })
      const client = await environment.runtime.pool.connect()
      try {
        await client.query("BEGIN")
        await client.query("SELECT id FROM session WHERE id=$1 FOR SHARE", [
          result.rows[0].id,
        ])
        const response = await fetch(
          environment.baseURL + "/api/auth/organization/has-permission",
          {
            method: "POST",
            headers: {
              cookie: owner.cookie,
              origin,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              organizationId: organization.id,
              permissions: { file: ["read"] },
            }),
            signal: AbortSignal.timeout(2000),
          }
        )
        expect(response.status, await response.clone().text()).toBe(200)
        expect(await response.json()).toMatchObject({ success: true })
      } finally {
        await client.query("ROLLBACK")
        client.release()
      }
    })

    it("keeps personal upload independent of a suspended organization", async () => {
      const current = await uploaded()
      const saved = await save(current.media.id)
      expect(saved.status).toBe(200)
      const operator = await platformOperator(environment, origin)
      const state = await environment.migrator.query(
        "SELECT status_version FROM organization_status WHERE organization_id=$1",
        [organization.id]
      )
      const suspended = await fetch(
        environment.baseURL +
          "/api/v1/platform/organizations/" +
          organization.id +
          "/suspend",
        {
          method: "POST",
          headers: {
            cookie: operator.cookie,
            origin,
            "content-type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({
            reason: "Personal media access acceptance",
            expectedVersion: state.rows[0].status_version,
          }),
        }
      )
      expect(suspended.status, await suspended.clone().text()).toBe(200)
      await error(
        await read(current.media.id, viewer, organization.id),
        404,
        "NOT_FOUND"
      )
      expect((await read(current.media.id)).status).toBe(200)
      expect((await upload()).status).toBe(201)
      expect((await save(null, current.media.contentUrl)).status).toBe(200)
    })

    it("publishes the formal binary upload/content and CAS contracts in OpenAPI", async () => {
      const response = await fetch(environment.baseURL + "/api/docs-json")
      expect(response.status).toBe(200)
      const doc = await response.json()
      const upload = doc.paths["/api/v1/personal-media"].post
      expect(upload.operationId).toBe("uploadPersonalMedia")
      expect(upload.parameters).toContainEqual(
        expect.objectContaining({
          name: "idempotency-key",
          in: "header",
          required: true,
          schema: { type: "string", format: "uuid" },
        })
      )
      for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif"])
        expect(upload.requestBody.content[mime].schema).toEqual({
          type: "string",
          format: "binary",
        })
      const content = doc.paths["/api/v1/personal-media/{mediaId}/content"].get
      expect(content.operationId).toBe("getPersonalMediaContent")
      expect(content.parameters).toContainEqual(
        expect.objectContaining({
          name: "organizationId",
          in: "query",
          required: false,
        })
      )
      expect(
        content.responses["200"].content["application/octet-stream"].schema
      ).toEqual({ type: "string", format: "binary" })
      expect(doc.paths["/api/v1/personal-media/avatar"].put.operationId).toBe(
        "setPersonalAvatar"
      )
    })

    it("runs the native GitHub callback creation hook with no persisted external avatar", async () => {
      const nativeFetch = globalThis.fetch
      if (backend === "RustFS")
        globalThis.fetch = (input, init) => {
          const url = new URL(
            typeof input === "string" ? input : (input.url ?? input.toString())
          )
          if (
            (url.hostname === "github.com" &&
              url.pathname === "/login/oauth/access_token") ||
            (url.hostname === "api.github.com" &&
              ["/user", "/user/emails"].includes(url.pathname))
          )
            return nativeFetch(
              new URL(url.pathname, environment.oauthProbe),
              init
            )
          return nativeFetch(input, init)
        }
      try {
        const started = await fetch(
          environment.baseURL + "/api/auth/sign-in/social",
          {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify({
              provider: "github",
              callbackURL: origin + "/oauth-complete",
              disableRedirect: true,
            }),
          }
        )
        expect(started.status, await started.clone().text()).toBe(200)
        const info = await started.json()
        const state = new URL(info.url).searchParams.get("state")
        const cookie = started.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ")
        const result = await fetch(
          environment.baseURL +
            "/api/auth/callback/github?code=personal-probe&state=" +
            encodeURIComponent(state),
          { headers: { origin, cookie }, redirect: "manual" }
        )
        expect(
          result.status,
          (await result.clone().text()) + (environment.logs?.() ?? "")
        ).toBe(302)
        expect(result.headers.get("location")).toBe(origin + "/oauth-complete")
        const sessionCookie = result.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ")
        const session = await fetch(
          environment.baseURL + "/api/auth/get-session",
          { headers: { cookie: sessionCookie, origin } }
        )
        expect(session.status).toBe(200)
        const account = await session.json()
        expect(account.user).toMatchObject({
          name: environment.oauthProfile.name,
          email: environment.oauthProfile.email,
          image: null,
        })
        const row = await environment.observer.query(
          'SELECT name,image,preferred_locale FROM public."user" WHERE id=$1',
          [account.user.id]
        )
        expect(row.rows[0]).toEqual({
          name: environment.oauthProfile.name,
          image: null,
          preferred_locale: null,
        })
      } finally {
        globalThis.fetch = nativeFetch
      }
    })

    it("terminates content when the actual opened backend stream is truncated", async () => {
      const body = Buffer.alloc(5 * 1024 * 1024)
      images.png.copy(body)
      const media = await uploaded(body)
      const address = {
        owner: { kind: "personal", id: owner.user.id },
        area: "files",
        segments: [media.media.id],
      }
      if (backend === "Local") {
        const result = await environment.physical.readAndTruncate(
          address,
          api("/" + media.media.id + "/content"),
          { cookie: owner.cookie, origin }
        )
        expect(result.status).toBe(200)
        expect(result.expectedBytes).toBe(body.length)
        expect(result.receivedBytes).toBeGreaterThan(0)
        expect(result.receivedBytes).toBeLessThan(body.length)
        expect(result.terminated).toBe(true)
      } else {
        const barrier = environment.proxy.hold(
          environment.proxyPath(address),
          "body"
        )
        try {
          const response = fetch(api("/" + media.media.id + "/content"), {
            headers: { cookie: owner.cookie, origin },
          })
          await barrier.observed
          const opened = await response
          expect(opened.status).toBe(200)
          barrier.release()
          await expect(opened.arrayBuffer()).rejects.toThrow()
          await waitFor(() => environment.proxy.activeReads() === 0)
        } finally {
          barrier.release()
        }
      }
    })

    if (backend === "RustFS") {
      it("holds a media share lock until real GetObject opens and cancels a disconnected open", async () => {
        const result = await uploaded()
        const address = {
          owner: { kind: "personal", id: owner.user.id },
          area: "files",
          segments: [result.media.id],
        }
        const barrier = environment.proxy.hold(
          environment.proxyPath(address),
          "headers"
        )
        const client = await environment.migrator.connect()
        let settled = false
        try {
          const response = read(result.media.id)
          await barrier.observed
          await client.query("BEGIN")
          await client.query("SET LOCAL ROLE platform_executor")
          await client.query(
            "SELECT set_config('app.personal_media_user_id',$1,true)",
            [owner.user.id]
          )
          const locked = client
            .query("SELECT id FROM personal_media WHERE id=$1 FOR UPDATE", [
              result.media.id,
            ])
            .then(() => {
              settled = true
            })
          await waitFor(
            async () =>
              (
                await observe(
                  "SELECT count(*)::int AS count FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0"
                )
              ).rows[0].count > 0
          )
          expect(settled).toBe(false)
          barrier.release()
          expect((await response).status).toBe(200)
          await locked
        } finally {
          barrier.release()
          await client.query("ROLLBACK")
          client.release()
        }
        const disconnected = environment.proxy.hold(
          environment.proxyPath(address),
          "headers"
        )
        const controller = new AbortController()
        try {
          const promise = fetch(api("/" + result.media.id + "/content"), {
            headers: { cookie: owner.cookie, origin },
            signal: controller.signal,
          }).then(
            () => false,
            () => true
          )
          await disconnected.observed
          controller.abort()
          expect(await promise).toBe(true)
          await waitFor(() => environment.proxy.activeReads() === 0)
        } finally {
          disconnected.release()
        }
      })

      it("renews the actual lease while a real PutObject acknowledgement is pending", async () => {
        const barrier = environment.proxy.hold(undefined, "headers", "PUT")
        const key = randomUUID()
        try {
          const response = upload(images.png, "image/png", owner, key)
          await barrier.observed
          const original = await observe(
            "SELECT lease_expires_at FROM personal_media_operations WHERE id='" +
              key +
              "' AND user_id='" +
              owner.user.id +
              "'"
          )
          const deadline = Date.now() + 40_000
          let renewed = false
          while (Date.now() < deadline) {
            const current = await observe(
              "SELECT lease_expires_at FROM personal_media_operations WHERE id='" +
                key +
                "' AND user_id='" +
                owner.user.id +
                "'"
            )
            if (
              new Date(current.rows[0].lease_expires_at).getTime() >
              new Date(original.rows[0].lease_expires_at).getTime() + 20_000
            ) {
              renewed = true
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }
          expect(renewed).toBe(true)
          barrier.release()
          expect((await response).status).toBe(201)
        } finally {
          barrier.release()
        }
      })

      it("rechecks the Session after a real Put ack, hands off unpublished bytes and cleans only a fixed claimed job", async () => {
        const actor = await signUpVerified(
          environment.baseURL,
          origin,
          environment.migrator
        )
        const barrier = environment.proxy.hold(undefined, "headers", "PUT")
        const key = randomUUID()
        try {
          const response = upload(images.png, "image/png", actor, key)
          await barrier.observed
          await environment.migrator.query(
            "DELETE FROM session WHERE user_id=$1",
            [actor.user.id]
          )
          barrier.release()
          await error(await response, 401, "UNAUTHENTICATED")
          const candidates = await environment.runtime.pool.query(
            "SELECT public.get_personal_media_maintenance_candidates(100) AS result"
          )
          expect(candidates.rows[0].result).toContainEqual({
            userId: actor.user.id,
            kind: "upload",
            id: key,
          })
          await environment.app
            .get(FilesRuntime)
            .requirePhysicalScope()
            .run({ kind: "personal", id: actor.user.id }, async (signal) => {
              const leaseId = randomUUID()
              const claimed = await environment.runtime.pool.query(
                "SELECT public.claim_personal_media_maintenance($1,'upload',$2,$3) AS job",
                [actor.user.id, key, leaseId]
              )
              const job = claimed.rows[0].job
              expect(job.storagePath).toEqual([job.mediaId])
              const address = {
                owner: { kind: "personal", id: actor.user.id },
                area: "files",
                segments: job.storagePath,
              }
              const stored = await environment.app
                .get(FilesRuntime)
                .requireStorage()
                .open(address, undefined, signal)
              const chunks = []
              for await (const chunk of stored.body) chunks.push(chunk)
              expect(Buffer.concat(chunks)).toEqual(images.png)
              await environment.app
                .get(FilesRuntime)
                .requireStorage()
                .remove(address, signal)
              await environment.runtime.pool.query(
                "SELECT public.finish_personal_media_maintenance($1,'upload',$2,$3,$4)",
                [actor.user.id, key, leaseId, randomUUID()]
              )
              await expect(
                environment.app.get(FilesRuntime).requireStorage().open(address)
              ).rejects.toMatchObject({ code: "STORAGE_NOT_FOUND" })
            })
          const status = await observe(
            "SELECT phase,cleaned_at FROM personal_media_operations WHERE id='" +
              key +
              "' AND user_id='" +
              actor.user.id +
              "'"
          )
          expect(status.rows[0].phase).toBe("failed")
          expect(status.rows[0].cleaned_at).not.toBeNull()
        } finally {
          barrier.release()
        }
      })

      it("cancels an acknowledged-unknown Put when its lease is no longer renewable without reporting success", async () => {
        const barrier = environment.proxy.hold(undefined, "headers", "PUT")
        const key = randomUUID()
        try {
          const response = upload(images.png, "image/png", owner, key)
          await barrier.observed
          await environment.observer.query(
            "UPDATE personal_media_operations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1 AND id=$2",
            [owner.user.id, key]
          )
          await error(await response, 409, "FILE_OPERATION_IN_PROGRESS")
          const facts = await observe(
            "SELECT phase,error_code FROM personal_media_operations WHERE user_id='" +
              owner.user.id +
              "' AND id='" +
              key +
              "'"
          )
          expect(facts.rows[0]).toMatchObject({
            phase: "preparing",
            error_code: "FILE_OPERATION_LEASE_CONFLICT",
          })
          const media = await observe(
            "SELECT id FROM personal_media WHERE operation_id='" + key + "'"
          )
          expect(media.rows).toEqual([])
        } finally {
          barrier.release()
        }
      })
    }
  }
)
