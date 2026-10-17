import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UnrecoverableError } from "bullmq"
import { readWorkerConfig } from "../src/config.ts"
import { TaskPermanentError } from "../src/contract.ts"
import {
  createPlatformTaskRuntime,
  PlatformTaskReferenceSchema,
  type PlatformTaskReference,
  type PlatformTaskRuntimeCallbacks,
} from "../src/platform-runtime.ts"

type MockJob = {
  id: string
  name: string
  data: unknown
  attemptsMade: number
  opts: { attempts?: number }
  failedReason: string
  getState: () => Promise<string>
}
const mocks = vi.hoisted(() => ({
  jobs: new Map<string, MockJob>(),
  processor: undefined as ((job: MockJob) => Promise<unknown>) | undefined,
  workerHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  queueConstructor: vi.fn(),
  workerConstructor: vi.fn(),
  redisConstructor: vi.fn(),
  redisInstances: [] as Array<{ disconnect: ReturnType<typeof vi.fn> }>,
  queueOn: vi.fn(),
  redisOn: vi.fn(),
  getJob: vi.fn<(id: string) => Promise<MockJob | undefined>>(),
  add: vi.fn<
    (
      name: string,
      data: PlatformTaskReference,
      options: { jobId: string }
    ) => Promise<MockJob>
  >(),
  workerClose: vi.fn<() => Promise<void>>(),
  queueClose: vi.fn<() => Promise<void>>(),
}))

vi.mock("bullmq", () => ({
  UnrecoverableError: class UnrecoverableError extends Error {},
  Queue: class Queue {
    getJob = mocks.getJob
    add = mocks.add
    on = mocks.queueOn
    close = mocks.queueClose
    constructor(...args: unknown[]) {
      mocks.queueConstructor(...args)
    }
  },
  Worker: class Worker {
    close = mocks.workerClose
    constructor(
      name: string,
      processor: (job: MockJob) => Promise<unknown>,
      options: unknown
    ) {
      mocks.processor = processor
      mocks.workerConstructor(name, options)
    }
    on(event: string, listener: (...args: unknown[]) => unknown) {
      mocks.workerHandlers.set(event, listener)
      return this
    }
  },
}))
vi.mock("ioredis", () => ({
  Redis: class Redis {
    on = mocks.redisOn
    disconnect = vi.fn()
    constructor(...args: unknown[]) {
      mocks.redisConstructor(...args)
      mocks.redisInstances.push(this)
    }
  },
}))

const reference: PlatformTaskReference = {
  scope: "platform",
  taskId: "d1cc485a-b8f3-44da-899a-18414fcbca04",
  actorId: "7461ce1f-03d3-4924-b2be-a3776cc1e649",
  sessionId: "3710318b-7cf7-4ed8-8b21-b155324ad37c",
  requestId: "platform-task-request",
}
const config = readWorkerConfig({ REDIS_URL: "redis://localhost:6379" })
const runtimes: Array<ReturnType<typeof createPlatformTaskRuntime>> = []

function job(state = "waiting", data: unknown = reference): MockJob {
  return {
    id: reference.taskId,
    name: "platform-task",
    data,
    attemptsMade: 0,
    opts: { attempts: config.attempts },
    failedReason: "",
    getState: vi.fn().mockResolvedValue(state),
  }
}
function callbacks(): PlatformTaskRuntimeCallbacks {
  return {
    pending: vi.fn().mockResolvedValue([]),
    queued: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue(undefined),
    failed: vi.fn().mockResolvedValue(undefined),
    fault: vi.fn(),
  }
}
function start(callback: PlatformTaskRuntimeCallbacks) {
  const runtime = createPlatformTaskRuntime(config, callback)
  runtimes.push(runtime)
  return runtime
}
async function flush() {
  await vi.advanceTimersByTimeAsync(0)
}
function failed(job: MockJob | undefined, error: Error) {
  return mocks.workerHandlers.get("failed")?.(job, error)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  mocks.jobs.clear()
  mocks.workerHandlers.clear()
  mocks.redisInstances.length = 0
  mocks.processor = undefined
  mocks.getJob.mockImplementation(async (id) => mocks.jobs.get(id))
  mocks.add.mockImplementation(async (name, data, options) => {
    const added = { ...job(), id: options.jobId, name, data }
    mocks.jobs.set(options.jobId, added)
    return added
  })
  mocks.workerClose.mockResolvedValue(undefined)
  mocks.queueClose.mockResolvedValue(undefined)
})
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
  vi.useRealTimers()
})

describe("platform queue reference boundary", () => {
  it("accepts only a platform scope and the exact reference fields", () => {
    expect(PlatformTaskReferenceSchema.parse(reference)).toEqual(reference)
    expect(
      PlatformTaskReferenceSchema.safeParse({
        ...reference,
        scope: "tenant",
        organizationId: reference.taskId,
      }).success
    ).toBe(false)
    expect(
      PlatformTaskReferenceSchema.safeParse({
        ...reference,
        input: { password: "private" },
      }).success
    ).toBe(false)
    expect(
      PlatformTaskReferenceSchema.safeParse({
        ...reference,
        sessionId: "invalid",
      }).success
    ).toBe(false)
  })

  it("uses a separate platform queue and publishes only the bound identity", async () => {
    const callback = callbacks()
    vi.mocked(callback.pending).mockResolvedValue([reference])
    start(callback)
    await flush()
    expect(mocks.queueConstructor).toHaveBeenCalledWith(
      `${config.queueName}-platform`,
      expect.objectContaining({
        prefix: config.queuePrefix,
        defaultJobOptions: expect.objectContaining({
          attempts: config.attempts,
        }),
      })
    )
    expect(mocks.workerConstructor).toHaveBeenCalledWith(
      `${config.queueName}-platform`,
      expect.objectContaining({ concurrency: config.concurrency })
    )
    expect(mocks.add).toHaveBeenCalledWith("platform-task", reference, {
      jobId: reference.taskId,
    })
    expect(Object.keys(mocks.add.mock.calls[0][1]).sort()).toEqual([
      "actorId",
      "requestId",
      "scope",
      "sessionId",
      "taskId",
    ])
    expect(callback.queued).toHaveBeenCalledWith(reference)
    expect(mocks.redisConstructor.mock.calls[0][1]).toMatchObject({
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
    expect(mocks.redisConstructor.mock.calls[1][1]).toMatchObject({
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    })
  })

  it("does not publish inputs or credentials returned by an invalid pending projection", async () => {
    const callback = callbacks()
    vi.mocked(callback.pending).mockResolvedValue([
      {
        ...reference,
        input: { initialPassword: "secret-password" },
        credentialCiphertext: "private-ciphertext",
      } as PlatformTaskReference,
    ])
    start(callback)
    await flush()
    expect(mocks.add).not.toHaveBeenCalled()
    expect(callback.fault).toHaveBeenCalledExactlyOnceWith()
    expect(callback.execute).not.toHaveBeenCalled()
  })

  it.each([
    ["tenant scope", { ...reference, scope: "tenant" }, reference.taskId],
    ["wrong queue binding", reference, "e1cc485a-b8f3-44da-899a-18414fcbca04"],
    [
      "injected input",
      { ...reference, input: { password: "private" } },
      reference.taskId,
    ],
    ["invalid actor", { ...reference, actorId: "invalid" }, reference.taskId],
  ])(
    "rejects %s before invoking any execution callback",
    async (_label, data, id) => {
      const callback = callbacks()
      start(callback)
      await flush()
      await expect(mocks.processor!({ ...job(), data, id })).rejects.toThrow(
        "INVALID_PLATFORM_TASK"
      )
      expect(callback.execute).not.toHaveBeenCalled()
    }
  )

  it("executes a valid bound reference without constructing tenant context", async () => {
    const callback = callbacks()
    start(callback)
    await flush()
    await mocks.processor!(job())
    expect(callback.execute).toHaveBeenCalledExactlyOnceWith(reference)
    expect(callback.failed).not.toHaveBeenCalled()
  })

  it("persists only stable execution failure messages, excluding original causes", async () => {
    const callback = callbacks()
    vi.mocked(callback.execute).mockRejectedValueOnce(
      new Error("password=private; SQL failed")
    )
    start(callback)
    await flush()
    const error = await mocks.processor!(job()).catch((error: unknown) => error)
    expect(error).toEqual(new Error("EXECUTION_FAILED"))
    expect((error as Error).cause).toBeUndefined()
    vi.mocked(callback.execute).mockRejectedValueOnce(
      new TaskPermanentError("PERMISSION_DENIED")
    )
    await expect(mocks.processor!(job())).rejects.toBeInstanceOf(
      UnrecoverableError
    )
  })
})

describe("platform pending recovery and final settlement", () => {
  it("keeps polling after database and Redis outages and eventually publishes the durable intent", async () => {
    const callback = callbacks()
    vi.mocked(callback.pending)
      .mockRejectedValueOnce(new Error("private-database-error"))
      .mockResolvedValue([reference])
    mocks.getJob.mockRejectedValueOnce(new Error("private-redis-error"))
    start(callback)
    await flush()
    expect(callback.fault).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(callback.fault).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.add).toHaveBeenCalledTimes(1)
    expect(callback.queued).toHaveBeenCalledWith(reference)
    expect(vi.mocked(callback.fault).mock.calls).toEqual([[], []])
  })

  it("retries queued acknowledgement without adding a second job", async () => {
    const callback = callbacks()
    vi.mocked(callback.pending).mockResolvedValue([reference])
    vi.mocked(callback.queued).mockRejectedValueOnce(
      new Error("acknowledgement failed")
    )
    start(callback)
    await flush()
    expect(callback.fault).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.add).toHaveBeenCalledTimes(1)
    expect(callback.queued).toHaveBeenCalledTimes(2)
  })

  it("recovers an active task after restart without duplicate enqueue or early failure settlement", async () => {
    const callback = callbacks()
    vi.mocked(callback.pending).mockResolvedValue([reference])
    const active = job("active")
    mocks.jobs.set(reference.taskId, active)
    start(callback)
    await flush()
    expect(mocks.add).not.toHaveBeenCalled()
    expect(callback.queued).toHaveBeenCalledWith(reference)
    expect(callback.failed).not.toHaveBeenCalled()
    active.getState = vi.fn().mockResolvedValue("failed")
    active.failedReason = "EXECUTION_FAILED"
    await vi.advanceTimersByTimeAsync(1000)
    expect(callback.failed).toHaveBeenCalledWith(reference, "EXECUTION_FAILED")
  })

  it("settles a failed persisted job and sanitizes an untrusted Redis reason", async () => {
    const callback = callbacks()
    vi.mocked(callback.pending).mockResolvedValue([reference])
    const existing = job("failed")
    existing.failedReason = "password=private"
    mocks.jobs.set(reference.taskId, existing)
    start(callback)
    await flush()
    expect(callback.failed).toHaveBeenCalledExactlyOnceWith(
      reference,
      "EXECUTION_FAILED"
    )
    expect(callback.queued).not.toHaveBeenCalled()
  })

  it("recovers a failed final settlement through the next durable non-terminal scan", async () => {
    const callback = callbacks()
    let databaseStatus = "running"
    vi.mocked(callback.pending).mockImplementation(async () =>
      databaseStatus === "running" ? [reference] : []
    )
    const active = job("active")
    mocks.jobs.set(reference.taskId, active)
    vi.mocked(callback.failed)
      .mockRejectedValueOnce(new Error("private-database-error"))
      .mockImplementation(async () => {
        databaseStatus = "failed"
      })
    start(callback)
    await flush()
    active.getState = vi.fn().mockResolvedValue("failed")
    active.failedReason = "EXECUTION_FAILED"
    active.attemptsMade = config.attempts
    failed(active, new Error("EXECUTION_FAILED"))
    await flush()
    expect(databaseStatus).toBe("running")
    expect(callback.fault).toHaveBeenCalledExactlyOnceWith()
    await vi.advanceTimersByTimeAsync(1000)
    expect(databaseStatus).toBe("failed")
    expect(callback.failed).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(callback.failed).toHaveBeenCalledTimes(2)
  })

  it("leaves completed jobs untouched during recovery", async () => {
    const callback = callbacks()
    vi.mocked(callback.pending).mockResolvedValue([reference])
    mocks.jobs.set(reference.taskId, job("completed"))
    start(callback)
    await flush()
    expect(mocks.add).not.toHaveBeenCalled()
    expect(callback.queued).not.toHaveBeenCalled()
    expect(callback.failed).not.toHaveBeenCalled()
  })

  it("does not settle a retryable intermediate failure and settles the final exhausted attempt", async () => {
    const callback = callbacks()
    start(callback)
    await flush()
    const executing = job("active")
    executing.attemptsMade = config.attempts - 1
    failed(executing, new Error("EXECUTION_FAILED"))
    await flush()
    expect(callback.failed).not.toHaveBeenCalled()
    executing.attemptsMade = config.attempts
    failed(executing, new Error("EXECUTION_FAILED"))
    await flush()
    expect(callback.failed).toHaveBeenCalledExactlyOnceWith(
      reference,
      "EXECUTION_FAILED"
    )
  })

  it("settles an unrecoverable denial on the first attempt even while the database was running", async () => {
    const callback = callbacks()
    start(callback)
    await flush()
    const denied = job("failed")
    denied.attemptsMade = 1
    failed(denied, new UnrecoverableError("PERMISSION_DENIED"))
    await flush()
    expect(callback.failed).toHaveBeenCalledExactlyOnceWith(
      reference,
      "PERMISSION_DENIED"
    )
  })

  it("never settles an unbound failed event and reports asynchronous settlement faults without exception text", async () => {
    const callback = callbacks()
    vi.mocked(callback.failed).mockRejectedValue(new Error("password=private"))
    start(callback)
    await flush()
    const unbound = {
      ...job(),
      id: "e1cc485a-b8f3-44da-899a-18414fcbca04",
      attemptsMade: config.attempts,
    }
    failed(undefined, new UnrecoverableError("INVALID_PLATFORM_TASK"))
    failed(unbound, new UnrecoverableError("INVALID_PLATFORM_TASK"))
    expect(callback.failed).not.toHaveBeenCalled()
    failed(job(), new UnrecoverableError("PERMISSION_DENIED"))
    await flush()
    expect(callback.fault).toHaveBeenCalledExactlyOnceWith()
  })

  it("waits for final database settlement on shutdown and stops further polling", async () => {
    const callback = callbacks()
    let resolveSettlement!: () => void
    vi.mocked(callback.failed).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSettlement = resolve
      })
    )
    const runtime = start(callback)
    await flush()
    failed(job(), new UnrecoverableError("PERMISSION_DENIED"))
    await flush()
    const closing = runtime.close()
    await flush()
    expect(mocks.workerClose).toHaveBeenCalledTimes(1)
    expect(mocks.queueClose).not.toHaveBeenCalled()
    expect(
      mocks.redisInstances.every(
        (redis) => redis.disconnect.mock.calls.length === 0
      )
    ).toBe(true)
    resolveSettlement()
    await closing
    runtimes.splice(runtimes.indexOf(runtime), 1)
    expect(mocks.queueClose).toHaveBeenCalledTimes(1)
    expect(
      mocks.redisInstances.every(
        (redis) => redis.disconnect.mock.calls.length === 1
      )
    ).toBe(true)
    const count = vi.mocked(callback.pending).mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(callback.pending).toHaveBeenCalledTimes(count)
  })
})
