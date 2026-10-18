import { canonicalJsonHash, hashJson as hash } from "./json-digest.ts"
import { z } from "zod"
import type { TenantTx } from "@workspace/database/tenant"
import type { PermissionRequest } from "@workspace/permissions"
import { supportedLocales } from "@workspace/i18n/locale"

export class TaskPermanentError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = "TaskPermanentError"
  }
}

const identitySchema = z.strictObject({
  organizationId: z.uuid().toLowerCase(),
  actorId: z.uuid().toLowerCase(),
  resourceId: z.uuid().toLowerCase(),
  locale: z.enum(supportedLocales),
  requestId: z.string().min(1).max(200),
})
const requestSchema = z.strictObject({
  type: z.string().regex(/^[a-z][a-z0-9.-]{0,99}$/),
  identity: identitySchema,
  idempotencyKey: z.string().min(1).max(200),
  input: z.unknown(),
})
const envelopeSchema = requestSchema.extend({
  intentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type TaskIdentity = z.infer<typeof identitySchema>
export type TaskRequest = z.infer<typeof requestSchema>
export type TaskEnvelope = z.infer<typeof envelopeSchema>
export type TaskContext<I = unknown> = {
  identity: TaskIdentity
  jobId: string
  idempotencyKey: string
  intentFingerprint: string
  input: I
  attempt: number
}
export type CommittedTask<R = unknown> = {
  intentFingerprint: string
  result: R
}
export type TaskTenantRunner = <T>(
  identity: TaskIdentity,
  permissions: PermissionRequest,
  work: (tx: TenantTx) => Promise<T>
) => Promise<T>

export type TaskDefinition<I, R> = {
  type: string
  inputSchema: z.ZodType<I>
  permissions: PermissionRequest
  authorizeResource: (tx: TenantTx, task: TaskContext<I>) => Promise<void>
  findCommitted: (
    tx: TenantTx,
    task: TaskContext<I>
  ) => Promise<CommittedTask<R> | undefined>
  execute: (tx: TenantTx, task: TaskContext<I>) => Promise<R>
}
export type RegisteredTask = {
  type: string
  permissions: PermissionRequest
  parseInput: (input: unknown) => unknown
  authorizeResource: (tx: TenantTx, task: TaskContext) => Promise<void>
  findCommitted: (
    tx: TenantTx,
    task: TaskContext
  ) => Promise<CommittedTask | undefined>
  execute: (tx: TenantTx, task: TaskContext) => Promise<unknown>
}

export function defineTask<I, R>(
  definition: TaskDefinition<I, R>
): RegisteredTask {
  function context(task: TaskContext): TaskContext<I> {
    return { ...task, input: definition.inputSchema.parse(task.input) }
  }
  return {
    type: definition.type,
    permissions: definition.permissions,
    parseInput: (input) => definition.inputSchema.parse(input),
    authorizeResource: (tx, task) =>
      definition.authorizeResource(tx, context(task)),
    findCommitted: (tx, task) => definition.findCommitted(tx, context(task)),
    execute: (tx, task) => definition.execute(tx, context(task)),
  }
}

export function taskJobId<
  T extends Pick<TaskIdentity, "organizationId" | "actorId">,
>(identity: T, type: string, key: string): string {
  return hash([identity.organizationId, identity.actorId, type, key])
}
function fingerprint(task: Omit<TaskEnvelope, "intentFingerprint">): string {
  // 请求关联标识会随网络重试改变；资源、语言和规范化输入共同决定业务意图。
  return canonicalJsonHash(
    z.json().parse({
      resourceId: task.identity.resourceId,
      locale: task.identity.locale,
      input: task.input,
    }),
    "code-unit"
  )
}
export function getTask(
  registry: readonly RegisteredTask[],
  type: string
): RegisteredTask {
  const task = registry.find((item) => item.type === type)
  if (!task) throw new TaskPermanentError("UNKNOWN_TASK")
  return task
}
export function createTaskEnvelope(
  registry: readonly RegisteredTask[],
  input: TaskRequest
): TaskEnvelope {
  try {
    const request = requestSchema.parse(input)
    const definition = getTask(registry, request.type)
    const task = {
      ...request,
      input: z.json().parse(definition.parseInput(request.input)),
    }
    return { ...task, intentFingerprint: fingerprint(task) }
  } catch (error) {
    if (error instanceof TaskPermanentError) throw error
    throw new TaskPermanentError("INVALID_TASK")
  }
}
export function readTaskEnvelope(
  registry: readonly RegisteredTask[],
  raw: unknown,
  jobId: string,
  jobName: string
): TaskEnvelope {
  let stored: TaskEnvelope
  try {
    stored = envelopeSchema.parse(raw)
  } catch {
    throw new TaskPermanentError("INVALID_TASK")
  }
  const task = createTaskEnvelope(registry, {
    type: stored.type,
    identity: stored.identity,
    idempotencyKey: stored.idempotencyKey,
    input: stored.input,
  })
  if (
    jobId !== taskJobId(task.identity, task.type, task.idempotencyKey) ||
    jobName !== task.type
  )
    throw new TaskPermanentError("TASK_IDENTITY_MISMATCH")
  if (task.intentFingerprint !== stored.intentFingerprint)
    throw new TaskPermanentError("TASK_IDENTITY_MISMATCH")
  return task
}
export function taskContext(task: TaskEnvelope, attempt: number): TaskContext {
  return {
    identity: task.identity,
    jobId: taskJobId(task.identity, task.type, task.idempotencyKey),
    idempotencyKey: task.idempotencyKey,
    intentFingerprint: task.intentFingerprint,
    input: task.input,
    attempt,
  }
}
export function assertSameIntent(
  actual: { intentFingerprint: string },
  expected: { intentFingerprint: string }
): void {
  if (actual.intentFingerprint !== expected.intentFingerprint)
    throw new TaskPermanentError("IDEMPOTENCY_CONFLICT")
}
