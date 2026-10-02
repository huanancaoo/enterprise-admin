import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { startAuthProbeDatabase } from "../setup/auth-probe-database.mjs"

const require = createRequire(resolve("apps/api/package.json"))
const { Pool } = require("pg")
const {
  FilePhysicalScope,
} = require("../../apps/api/dist/files/file-physical-scope.js")

describe("Files physical scope uses real PostgreSQL session ownership", () => {
  let resources
  let observer
  let first
  let second
  beforeAll(async () => {
    resources = new AsyncDisposableStack()
    const database = await startAuthProbeDatabase()
    resources.defer(() => database.container.stop())
    observer = new Pool({
      connectionString: database.url("bootstrap_admin", database.passwords[0]),
    })
    resources.defer(() => observer.end())
    const runtimeURL = database.url("app_runtime", database.passwords[2])
    first = new FilePhysicalScope(runtimeURL)
    resources.defer(() => first[Symbol.asyncDispose]())
    second = new FilePhysicalScope(runtimeURL)
    resources.defer(() => second[Symbol.asyncDispose]())
  })
  afterAll(async () => resources?.disposeAsync())

  test("a second API instance waits for the exact owner until physical work finishes", async () => {
    const owner = { kind: "organization", id: randomUUID() }
    const started = Promise.withResolvers()
    const release = Promise.withResolvers()
    let entered = false
    const leader = first.run(owner, async () => {
      started.resolve()
      await release.promise
    })
    await started.promise
    const follower = second.run(owner, () => {
      entered = true
      return Promise.resolve("settled")
    })
    try {
      await vi.waitFor(async () => {
        const blocked = await observer.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = 'enterprise-admin:files-physical-scope' AND wait_event = 'advisory'"
        )
        expect(blocked.rows[0].count).toBe(1)
      })
      expect(entered).toBe(false)
    } finally {
      release.resolve()
      await leader
    }
    expect(await follower).toBe("settled")
  })

  test("independent organizations and the same-ID personal owner do not share a lock", async () => {
    const owner = { kind: "organization", id: randomUUID() }
    const started = Promise.withResolvers()
    const release = Promise.withResolvers()
    const leader = first.run(owner, async () => {
      started.resolve()
      await release.promise
    })
    await started.promise
    try {
      expect(
        await second.run({ kind: "personal", id: owner.id }, () =>
          Promise.resolve("personal")
        )
      ).toBe("personal")
      expect(
        await second.run({ kind: "organization", id: randomUUID() }, () =>
          Promise.resolve("other")
        )
      ).toBe("other")
    } finally {
      release.resolve()
      await leader
    }
  })

  test("a failed physical phase releases the lock without changing its failure", async () => {
    const owner = { kind: "organization", id: randomUUID() }
    const failure = new Error("physical preparation failed")
    await expect(first.run(owner, () => Promise.reject(failure))).rejects.toBe(
      failure
    )
    expect(await second.run(owner, () => Promise.resolve("next"))).toBe("next")
  })

  test("loss of the lock connection aborts old work before another instance can settle", async () => {
    const owner = { kind: "organization", id: randomUUID() }
    const started = Promise.withResolvers()
    const operation = first.run(owner, (signal) => {
      started.resolve()
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        })
      })
    })
    // Attach the rejection observer before terminating the real lock connection.
    const rejected = expect(operation).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    })
    await started.promise
    const holder = await observer.query(
      "SELECT activity.pid FROM pg_stat_activity activity JOIN pg_locks locks ON locks.pid = activity.pid WHERE activity.application_name = 'enterprise-admin:files-physical-scope' AND locks.locktype = 'advisory' AND locks.granted"
    )
    expect(holder.rows).toHaveLength(1)
    await observer.query("SELECT pg_terminate_backend($1)", [
      holder.rows[0].pid,
    ])
    await rejected
    expect(await second.run(owner, () => Promise.resolve("reclaimed"))).toBe(
      "reclaimed"
    )
  })
})
