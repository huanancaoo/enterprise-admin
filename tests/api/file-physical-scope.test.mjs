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

  test("shutdown cancels a database lock waiter without entering work or releasing the holder", async () => {
    const owner = { kind: "organization", id: randomUUID() }
    const started = Promise.withResolvers()
    const release = Promise.withResolvers()
    const shutdown = new AbortController()
    let entered = false
    const holder = first.run(owner, async () => {
      started.resolve()
      await release.promise
    })
    await started.promise
    const cancelled = expect(
      second.run(
        owner,
        async () => {
          entered = true
        },
        shutdown.signal
      )
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" })
    try {
      await vi.waitFor(async () => {
        const waiting = await observer.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='enterprise-admin:files-physical-scope' AND wait_event='advisory'"
        )
        expect(waiting.rows[0].count).toBe(1)
      })
      shutdown.abort()
      await cancelled
      expect(entered).toBe(false)
      await vi.waitFor(async () => {
        const waiting = await observer.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='enterprise-admin:files-physical-scope' AND wait_event='advisory'"
        )
        expect(waiting.rows[0].count).toBe(0)
      })
    } finally {
      release.resolve()
      await holder
    }
    expect(await second.run(owner, async () => "next")).toBe("next")
  })

  test("active shutdown signals work and keeps its owner lock until I/O finishes", async () => {
    const owner = { kind: "organization", id: randomUUID() }
    const started = Promise.withResolvers()
    const release = Promise.withResolvers()
    const shutdown = new AbortController()
    let workSignal
    const cancelled = expect(
      first.run(
        owner,
        async (signal) => {
          workSignal = signal
          started.resolve()
          await release.promise
        },
        shutdown.signal
      )
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" })
    await started.promise
    let entered = false
    const follower = second.run(owner, async () => {
      entered = true
      return "next"
    })
    try {
      shutdown.abort()
      expect(workSignal.aborted).toBe(true)
      await vi.waitFor(async () => {
        const waiting = await observer.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='enterprise-admin:files-physical-scope' AND wait_event='advisory'"
        )
        expect(waiting.rows[0].count).toBe(1)
      })
      expect(entered).toBe(false)
    } finally {
      release.resolve()
      await cancelled
    }
    expect(await follower).toBe("next")
  })

  test("shutdown cancels a queued pool acquisition and releases its later connection", async () => {
    const started = Promise.withResolvers()
    const release = Promise.withResolvers()
    let count = 0
    const holders = Array.from({ length: 10 }, () =>
      first.run({ kind: "organization", id: randomUUID() }, async () => {
        if (++count === 10) started.resolve()
        await release.promise
      })
    )
    await started.promise
    const shutdown = new AbortController()
    let entered = false
    const cancelled = expect(
      first.run(
        { kind: "organization", id: randomUUID() },
        async () => {
          entered = true
        },
        shutdown.signal
      )
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" })
    try {
      shutdown.abort()
      await cancelled
      expect(entered).toBe(false)
    } finally {
      release.resolve()
      await Promise.all(holders)
    }
    expect(
      await first.run(
        { kind: "organization", id: randomUUID() },
        async () => "next"
      )
    ).toBe("next")
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
