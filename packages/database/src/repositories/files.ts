import {
  fileOperationBatches,
  fileOperationBatchItems,
} from "../schema/file-batches.ts"
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm"
import {
  fileEntries,
  fileNamespaceReservations,
  fileOperationObjects,
  fileOperations,
  fileReferences,
  fileStorageUsage,
  fileVersions,
  projectFileContents,
  type FileEntryPlan,
} from "../schema/files.ts"
import { auditEvents } from "../schema/audit.ts"
import { projects } from "../schema/projects.ts"
import type { TenantTx } from "../tenant.ts"

export type FileBatch = typeof fileOperationBatches.$inferSelect
export type FileBatchItem = typeof fileOperationBatchItems.$inferSelect
export type FileBatchRequest = {
  id: string
  action: FileBatch["action"]
  parentId?: string
  requestHash: string
  items: { entryId: string; expectedRevision: number; operationId: string }[]
}
export function fileBatchRootRequest(batch: FileBatch, item: FileBatchItem) {
  return {
    entryId: item.entryId,
    expectedRevision: item.expectedRevision,
    ...(batch.parentId ? { parentId: batch.parentId } : {}),
    batchId: batch.id,
    batchRequestHash: batch.requestHash,
  }
}

export type FileEntry = typeof fileEntries.$inferSelect
export type FileVersion = typeof fileVersions.$inferSelect
export type FileOperation = typeof fileOperations.$inferSelect
export type FileOperationObject = typeof fileOperationObjects.$inferSelect
export type FileUsage = typeof fileStorageUsage.$inferSelect
export type FileOperationInput = Pick<
  typeof fileOperations.$inferInsert,
  "id" | "action" | "requestHash" | "input" | "expiresAt"
>
export type FileListInput = {
  parentId?: string
  state: "active" | "trashed"
  name?: string
  page: number
  pageSize: number
  sortBy: "name" | "size" | "updatedAt"
  sortOrder: "asc" | "desc"
}
export type FileReferenceInput = {
  fileId: string
  versionId: string
  referenceKey: string
  position: number
}
export type FileReferenceBusiness = {
  projectId: string
  kind: "project_attachment" | "project_rich_text"
  locale: "zh-CN" | "en-US" | "ar" | null
}

export class FileRepositoryError extends Error {
  constructor(
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(code)
    this.name = "FileRepositoryError"
  }
}

const entryScope = (tx: TenantTx) =>
  eq(fileEntries.organizationId, tx.context.organizationId)
const operationScope = (tx: TenantTx, id: string) =>
  and(
    eq(fileOperations.organizationId, tx.context.organizationId),
    eq(fileOperations.id, id)
  )
const objectScope = (tx: TenantTx, id: string) =>
  and(
    eq(fileOperationObjects.organizationId, tx.context.organizationId),
    eq(fileOperationObjects.operationId, id)
  )

function fail(code: string, details?: Record<string, unknown>): never {
  throw new FileRepositoryError(code, details)
}
function assertRevision(entry: FileEntry, expected: number) {
  if (entry.revision !== expected)
    fail("VERSION_CONFLICT", { revision: entry.revision })
}
function assertPath(path: string[]) {
  if (Buffer.byteLength(path.join("/"), "utf8") > 512)
    fail("FILE_PATH_TOO_LONG")
}
function assertName(name: string, kind: "file" | "folder") {
  const limit = kind === "folder" ? 246 : 255
  if (
    !name ||
    name !== name.trim() ||
    name !== name.normalize("NFC") ||
    name === "." ||
    name === ".." ||
    /[\\/\p{Cc}]/u.test(name) ||
    /%(?:25)*(?:2f|5c)/iu.test(name)
  )
    fail("FILE_NAME_INVALID")
  if (Buffer.byteLength(name, "utf8") > limit)
    fail("FILE_NAME_TOO_LONG", { maximumBytes: limit })
}
async function lockOrganization(tx: TenantTx): Promise<FileUsage> {
  await tx.execute(
    sql`INSERT INTO public.file_storage_usage (organization_id) VALUES (${tx.context.organizationId}::uuid) ON CONFLICT DO NOTHING`
  )
  const [usage] = await tx
    .select()
    .from(fileStorageUsage)
    .where(eq(fileStorageUsage.organizationId, tx.context.organizationId))
    .for("update")
  if (!usage) throw new Error("File storage usage is missing")
  return usage
}
// Files 调用方先锁 usage；以默认 read runner 进入，避免提前持有 status。
// 原生组织写可能先刷新 Session 再锁 status，这里必须沿用 Session → status → member。
async function requireCurrentActor(
  tx: TenantTx,
  sessionId: string
): Promise<Date> {
  const active = await tx.execute<{ valid: boolean }>(sql`
    WITH locked_session AS MATERIALIZED (
      SELECT expires_at FROM public.session
      WHERE id = ${sessionId}::uuid AND user_id = ${tx.context.userId}::uuid
      FOR SHARE
    )
    SELECT expires_at > clock_timestamp() AS valid FROM locked_session
  `)
  if (!active.rows[0]?.valid) fail("UNAUTHENTICATED")
  await tx.execute(
    sql`SELECT public.require_active_organization(${tx.context.organizationId}::uuid)`
  )
  const membership = await tx.execute(sql`
    SELECT id FROM public.member
    WHERE id = ${tx.context.membershipId}::uuid
      AND organization_id = ${tx.context.organizationId}::uuid
      AND user_id = ${tx.context.userId}::uuid
    FOR SHARE
  `)
  if (!membership.rows[0]) fail("FORBIDDEN")
  // 等待 status/member 可能跨过到期时间；同一数据库时钟同时判断身份并供 lease 使用。
  const current = await tx.execute<{ now: string; valid: boolean }>(sql`
    WITH current_clock AS MATERIALIZED (SELECT clock_timestamp() AS now)
    SELECT current_clock.now, active_session.expires_at > current_clock.now AS valid
    FROM current_clock, public.session AS active_session
    WHERE active_session.id = ${sessionId}::uuid
      AND active_session.user_id = ${tx.context.userId}::uuid
  `)
  if (!current.rows[0]?.valid) fail("UNAUTHENTICATED")
  return new Date(current.rows[0].now)
}
async function findEntry(tx: TenantTx, id: string, lock?: "update" | "share") {
  const query = tx
    .select()
    .from(fileEntries)
    .where(and(entryScope(tx), eq(fileEntries.id, id)))
  const [entry] = await (lock ? query.for(lock) : query)
  return entry
}
async function requireEntry(tx: TenantTx, id: string) {
  const entry = await findEntry(tx, id, "update")
  if (!entry || entry.state === "purged") fail("FILE_NOT_FOUND")
  return entry
}
async function requireOperation(tx: TenantTx, id: string) {
  const [operation] = await tx
    .select()
    .from(fileOperations)
    .where(operationScope(tx, id))
    .for("update")
  if (!operation) fail("FILE_OPERATION_NOT_FOUND")
  return operation
}
async function assertAncestorsAvailable(
  tx: TenantTx,
  entry: FileEntry,
  operationId?: string
) {
  let cursor: FileEntry | undefined = entry
  while (cursor) {
    if (cursor.state !== "active") fail("FILE_FOLDER_NOT_FOUND")
    if (cursor.busyOperationId && cursor.busyOperationId !== operationId)
      fail("FILE_OPERATION_IN_PROGRESS", {
        operationId: cursor.busyOperationId,
      })
    cursor = cursor.parentId
      ? await findEntry(tx, cursor.parentId, "update")
      : undefined
  }
}
async function requireFolder(tx: TenantTx, id: string, operationId?: string) {
  const folder = await requireEntry(tx, id)
  if (folder.kind !== "folder" || folder.state !== "active")
    fail("FILE_FOLDER_NOT_FOUND")
  await assertAncestorsAvailable(tx, folder, operationId)
  return folder
}
async function assertAvailable(
  tx: TenantTx,
  parentId: string,
  name: string,
  operationId?: string,
  excludeId?: string
) {
  const [entry] = await tx
    .select({ id: fileEntries.id })
    .from(fileEntries)
    .where(
      and(
        entryScope(tx),
        eq(fileEntries.parentId, parentId),
        eq(fileEntries.name, name),
        eq(fileEntries.state, "active"),
        excludeId ? ne(fileEntries.id, excludeId) : undefined
      )
    )
  if (entry) fail("FILE_NAME_CONFLICT")
  const [reservation] = await tx
    .select()
    .from(fileNamespaceReservations)
    .where(
      and(
        eq(fileNamespaceReservations.organizationId, tx.context.organizationId),
        eq(fileNamespaceReservations.parentId, parentId),
        eq(fileNamespaceReservations.name, name)
      )
    )
  if (reservation && reservation.operationId !== operationId)
    fail("FILE_OPERATION_IN_PROGRESS", { operationId: reservation.operationId })
}
async function reserveNamespace(
  tx: TenantTx,
  operationId: string,
  parentId: string,
  name: string
) {
  const [reservation] = await tx
    .select()
    .from(fileNamespaceReservations)
    .where(
      and(
        eq(fileNamespaceReservations.organizationId, tx.context.organizationId),
        eq(fileNamespaceReservations.parentId, parentId),
        eq(fileNamespaceReservations.name, name)
      )
    )
  if (reservation) {
    if (reservation.operationId !== operationId)
      fail("FILE_OPERATION_IN_PROGRESS", {
        operationId: reservation.operationId,
      })
    return
  }
  await tx.insert(fileNamespaceReservations).values({
    organizationId: tx.context.organizationId,
    operationId,
    parentId,
    name,
  })
}
async function subtree(tx: TenantTx, root: FileEntry): Promise<FileEntry[]> {
  // 独立回收项保留原parentId；回收批次归属阻止它被后来删除的父目录吞并。
  const rows = await tx
    .select()
    .from(fileEntries)
    .where(
      and(
        entryScope(tx),
        eq(fileEntries.state, root.state),
        sql`${fileEntries.id} IN (
          WITH RECURSIVE descendants AS (
            SELECT id FROM public.file_entries WHERE organization_id = ${tx.context.organizationId}::uuid AND id = ${root.id}::uuid
            UNION ALL
            SELECT child.id FROM public.file_entries child JOIN descendants parent ON child.parent_id = parent.id
            WHERE child.organization_id = ${tx.context.organizationId}::uuid AND child.state = ${root.state}
              AND (child.state <> 'trashed' OR child.trash_root_id = ${root.trashRootId}::uuid)
          ) SELECT id FROM descendants
        )`
      )
    )
    .orderBy(asc(sql`cardinality(${fileEntries.path})`), asc(fileEntries.id))
    .for("update")
  return rows
}
async function assertNoReferences(tx: TenantTx, ids: string[]) {
  if (ids.length === 0) return
  const [row] = await tx
    .select({ total: count() })
    .from(fileReferences)
    .where(
      and(
        eq(fileReferences.organizationId, tx.context.organizationId),
        inArray(fileReferences.fileId, ids)
      )
    )
  if (row && row.total > 0)
    fail("FILE_REFERENCED", { referenceCount: row.total })
}
async function operationObjects(tx: TenantTx, id: string) {
  return tx
    .select()
    .from(fileOperationObjects)
    .where(objectScope(tx, id))
    .orderBy(asc(fileOperationObjects.id))
}
function assertNotCommitted(operation: FileOperation) {
  if (
    operation.committedAt ||
    operation.completedAt ||
    operation.phase === "failed"
  )
    fail("FILE_OPERATION_NOT_READY")
}
async function assertPrepared(tx: TenantTx, operation: FileOperation) {
  const objects = await operationObjects(tx, operation.id)
  if (
    objects.some(
      (object) => object.targetArea !== null && object.preparedAt === null
    )
  )
    fail("FILE_OPERATION_NOT_READY")
  return objects
}
async function recordAudit(
  tx: TenantTx,
  input: {
    eventCode: string
    resourceId: string
    resourceType: "file" | "folder" | "project"
    operationId?: string
    fields?: Record<string, unknown>
  }
) {
  await tx.insert(auditEvents).values({
    organizationId: tx.context.organizationId,
    actorId: tx.context.userId,
    requestId: tx.context.requestId,
    scope: "tenant",
    tenantVisible: true,
    eventCode: input.eventCode,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    operationId: input.operationId,
    fields: input.fields ?? {},
  })
}

export const fileRepository = {
  async findBatch(tx: TenantTx, id: string) {
    const [batch] = await tx
      .select()
      .from(fileOperationBatches)
      .where(
        and(
          eq(fileOperationBatches.organizationId, tx.context.organizationId),
          eq(fileOperationBatches.id, id)
        )
      )
    if (!batch) return undefined
    const items = await tx
      .select()
      .from(fileOperationBatchItems)
      .where(
        and(
          eq(fileOperationBatchItems.organizationId, tx.context.organizationId),
          eq(fileOperationBatchItems.batchId, id)
        )
      )
      .orderBy(asc(fileOperationBatchItems.index))
    return { batch, items }
  },

  async beginBatch(tx: TenantTx, request: FileBatchRequest) {
    await lockOrganization(tx)
    if (
      request.items.length < 1 ||
      request.items.length > 100 ||
      new Set(request.items.map((item) => item.entryId)).size !==
        request.items.length ||
      new Set(request.items.map((item) => item.operationId)).size !==
        request.items.length
    )
      fail("VALIDATION_ERROR")
    const requestHash = request.requestHash
    const existing = await this.findBatch(tx, request.id)
    if (existing) {
      if (
        existing.batch.actorId !== tx.context.userId ||
        existing.batch.action !== request.action ||
        existing.batch.requestHash !== requestHash
      )
        fail("IDEMPOTENCY_KEY_REUSED")
      return existing
    }
    const entries = await tx
      .select()
      .from(fileEntries)
      .where(
        and(
          eq(fileEntries.organizationId, tx.context.organizationId),
          inArray(
            fileEntries.id,
            request.items.map((item) => item.entryId)
          )
        )
      )
    const cache = new Map<string, FileEntry | undefined>(
      entries.map((entry) => [entry.id, entry])
    )
    const selected = new Map(
      request.items.map((item, index) => [item.entryId, index])
    )
    const state =
      request.action === "restore" || request.action === "purge"
        ? "trashed"
        : "active"
    const items: FileBatchItem[] = []
    for (const [index, item] of request.items.entries()) {
      const entry = cache.get(item.entryId)
      let rootIndex = index,
        cursor = entry
      // 只合并同一个可操作子树；独立回收批次的子项仍是独立根，不能被祖先吞并。
      while (entry?.state === state && cursor?.parentId) {
        if (!cache.has(cursor.parentId))
          cache.set(cursor.parentId, await findEntry(tx, cursor.parentId))
        const parent = cache.get(cursor.parentId)
        if (
          !parent ||
          parent.kind !== "folder" ||
          parent.state !== entry.state ||
          (state === "trashed" && parent.trashRootId !== entry.trashRootId)
        )
          break
        const ancestor = selected.get(parent.id)
        if (ancestor !== undefined) rootIndex = ancestor
        cursor = parent
      }
      items.push({
        organizationId: tx.context.organizationId,
        batchId: request.id,
        index,
        entryId: item.entryId,
        expectedRevision: item.expectedRevision,
        operationId: item.operationId,
        rootIndex,
        entryKind: entry?.kind ?? null,
      })
    }
    const [batch] = await tx
      .insert(fileOperationBatches)
      .values({
        id: request.id,
        organizationId: tx.context.organizationId,
        actorId: tx.context.userId,
        action: request.action,
        requestHash,
        parentId: request.parentId ?? null,
      })
      .returning()
    await tx.insert(fileOperationBatchItems).values(items)
    return { batch: batch!, items }
  },

  lockOrganization,
  requireCurrentActor,
  findEntry,
  operationObjects,
  reserveNamespace,
  assertAvailable,
  recordAudit,

  async ensureWorkspace(tx: TenantTx) {
    const usage = await lockOrganization(tx)
    await tx
      .insert(fileEntries)
      .values({
        organizationId: tx.context.organizationId,
        kind: "folder",
        parentId: null,
        name: "",
        path: [],
        createdBy: tx.context.userId,
      })
      .onConflictDoNothing()
    const [root] = await tx
      .select()
      .from(fileEntries)
      .where(and(entryScope(tx), isNull(fileEntries.parentId)))
    if (!root) throw new Error("File root is missing")
    return { root, usage }
  },

  async usage(tx: TenantTx) {
    const [usage] = await tx
      .select()
      .from(fileStorageUsage)
      .where(eq(fileStorageUsage.organizationId, tx.context.organizationId))
    return usage
  },

  async listPage(tx: TenantTx, input: FileListInput) {
    // 与写入共用组织行锁，让total和当前页来自同一个文件事实边界。
    await lockOrganization(tx)
    const filter = and(
      entryScope(tx),
      eq(fileEntries.state, input.state),
      ne(fileEntries.name, ""),
      input.name
        ? sql`position(lower(${input.name}) in lower(${fileEntries.name})) > 0`
        : input.parentId
          ? eq(fileEntries.parentId, input.parentId)
          : input.state === "trashed"
            ? eq(fileEntries.trashRootId, fileEntries.id)
            : undefined
    )
    const size = sql<number | null>`${fileVersions.bytes}`
    const sort =
      input.sortBy === "name"
        ? fileEntries.name
        : input.sortBy === "size"
          ? size
          : fileEntries.updatedAt
    const [total] = await tx
      .select({ total: count() })
      .from(fileEntries)
      .where(filter)
    const items = await tx
      .select({ entry: fileEntries, version: fileVersions })
      .from(fileEntries)
      .leftJoin(
        fileVersions,
        and(
          eq(fileVersions.organizationId, tx.context.organizationId),
          eq(fileVersions.fileId, fileEntries.id),
          eq(fileVersions.id, fileEntries.currentVersionId)
        )
      )
      .where(filter)
      .orderBy(
        input.sortOrder === "asc" ? asc(sort) : desc(sort),
        asc(fileEntries.id)
      )
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
    return {
      items,
      total: total!.total,
      page: input.page,
      pageSize: input.pageSize,
    }
  },

  async breadcrumbs(tx: TenantTx, id: string) {
    const entry = await findEntry(tx, id)
    if (!entry || entry.state !== "active" || entry.kind !== "folder")
      fail("FILE_FOLDER_NOT_FOUND")
    const result: FileEntry[] = [entry]
    let parentId = entry.parentId
    while (parentId) {
      const parent = await findEntry(tx, parentId)
      if (!parent || parent.state !== "active")
        throw new Error("File parent is missing")
      result.unshift(parent)
      parentId = parent.parentId
    }
    return result
  },

  async versions(tx: TenantTx, fileId: string) {
    return tx
      .select()
      .from(fileVersions)
      .where(
        and(
          eq(fileVersions.organizationId, tx.context.organizationId),
          eq(fileVersions.fileId, fileId),
          isNull(fileVersions.purgedAt)
        )
      )
      .orderBy(desc(fileVersions.createdAt), asc(fileVersions.id))
  },

  async findVersion(
    tx: TenantTx,
    fileId: string,
    versionId: string,
    lock?: "share"
  ) {
    const entry = await findEntry(tx, fileId, lock)
    if (!entry || entry.state !== "active" || entry.kind !== "file")
      fail("FILE_NOT_FOUND")
    if (entry.busyOperationId)
      fail("FILE_OPERATION_IN_PROGRESS", { operationId: entry.busyOperationId })
    const query = tx
      .select()
      .from(fileVersions)
      .where(
        and(
          eq(fileVersions.organizationId, tx.context.organizationId),
          eq(fileVersions.fileId, fileId),
          eq(fileVersions.id, versionId),
          isNull(fileVersions.purgedAt)
        )
      )
    const [version] = await (lock ? query.for(lock) : query)
    if (!version) fail("FILE_VERSION_NOT_FOUND")
    return { entry, version }
  },

  async beginOperation(tx: TenantTx, input: FileOperationInput) {
    await lockOrganization(tx)
    const [existing] = await tx
      .select()
      .from(fileOperations)
      .where(operationScope(tx, input.id))
      .for("update")
    if (existing) {
      if (
        existing.actorId !== tx.context.userId ||
        existing.action !== input.action ||
        existing.requestHash !== input.requestHash
      )
        fail("IDEMPOTENCY_KEY_REUSED")
      return { operation: existing, reused: true }
    }
    const [operation] = await tx
      .insert(fileOperations)
      .values({
        id: input.id,
        action: input.action,
        requestHash: input.requestHash,
        input: input.input,
        expiresAt: input.expiresAt,
        organizationId: tx.context.organizationId,
        actorId: tx.context.userId,
        requestId: tx.context.requestId,
      })
      .returning()
    return { operation: operation!, reused: false }
  },

  async findOperation(tx: TenantTx, id: string) {
    const [operation] = await tx
      .select()
      .from(fileOperations)
      .where(operationScope(tx, id))
    return operation
  },

  async claimOperation(
    tx: TenantTx,
    id: string,
    leaseId: string,
    now: Date,
    leaseMilliseconds = 120_000
  ) {
    await lockOrganization(tx)
    const operation = await requireOperation(tx, id)
    if (operation.completedAt || operation.phase === "failed") return undefined
    if (
      operation.leaseId &&
      operation.leaseId !== leaseId &&
      operation.leaseExpiresAt &&
      operation.leaseExpiresAt > now
    )
      return undefined
    const [claimed] = await tx
      .update(fileOperations)
      .set({
        leaseId,
        leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
        phase: operation.committedAt ? "cleaning" : "preparing",
        updatedAt: now,
      })
      .where(operationScope(tx, id))
      .returning()
    return claimed
  },

  async renewOperation(
    tx: TenantTx,
    id: string,
    leaseId: string,
    now: Date,
    leaseMilliseconds = 120_000
  ) {
    await lockOrganization(tx)
    const operation = await requireOperation(tx, id)
    // 续租不承担过期接管；迟到的执行者必须停止物理 I/O。
    if (
      operation.completedAt ||
      operation.phase === "failed" ||
      operation.leaseId !== leaseId ||
      !operation.leaseExpiresAt ||
      operation.leaseExpiresAt <= now
    )
      fail("FILE_OPERATION_LEASE_CONFLICT")
    const [renewed] = await tx
      .update(fileOperations)
      .set({
        leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
        updatedAt: now,
      })
      .where(operationScope(tx, id))
      .returning()
    return renewed!
  },

  async reserveUpload(
    tx: TenantTx,
    operationId: string,
    input: {
      parentId: string
      name: string
      declaredBytes: number
      overwriteId?: string
      expectedRevision?: number
    }
  ) {
    const usage = await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    assertNotCommitted(operation)
    if (operation.action !== (input.overwriteId ? "overwrite" : "upload"))
      fail("FILE_OPERATION_NOT_READY")
    if (
      !Number.isSafeInteger(input.declaredBytes) ||
      input.declaredBytes < 0 ||
      input.declaredBytes > 100 * 1024 ** 2
    )
      fail("FILE_TOO_LARGE")
    assertName(input.name, "file")
    const folder = await requireFolder(tx, input.parentId, operationId)
    assertPath([...folder.path, input.name])
    if (input.overwriteId) {
      const file = await requireEntry(tx, input.overwriteId)
      if (
        file.kind !== "file" ||
        file.state !== "active" ||
        file.parentId !== input.parentId ||
        file.name !== input.name
      )
        fail("FILE_NOT_FOUND")
      assertRevision(file, input.expectedRevision!)
      if (file.busyOperationId && file.busyOperationId !== operationId)
        fail("FILE_OPERATION_IN_PROGRESS", {
          operationId: file.busyOperationId,
        })
      await tx
        .update(fileEntries)
        .set({ busyOperationId: operationId })
        .where(and(entryScope(tx), eq(fileEntries.id, file.id)))
    }
    await assertAvailable(
      tx,
      input.parentId,
      input.name,
      operationId,
      input.overwriteId
    )
    await reserveNamespace(tx, operationId, input.parentId, input.name)
    if (operation.reservedBytes > 0) {
      if (operation.reservedBytes !== input.declaredBytes)
        fail("IDEMPOTENCY_KEY_REUSED")
      return
    }
    if (
      usage.usedBytes + usage.reservedBytes + input.declaredBytes >
      usage.quotaBytes
    )
      fail("FILE_QUOTA_EXCEEDED", {
        quotaBytes: usage.quotaBytes,
        usedBytes: usage.usedBytes,
        reservedBytes: usage.reservedBytes,
      })
    await tx
      .update(fileStorageUsage)
      .set({ reservedBytes: usage.reservedBytes + input.declaredBytes })
      .where(eq(fileStorageUsage.organizationId, tx.context.organizationId))
    await tx
      .update(fileOperations)
      .set({
        reservedBytes: input.declaredBytes,
        phase: "preparing",
        updatedAt: new Date(),
      })
      .where(operationScope(tx, operationId))
  },

  async addObjects(
    tx: TenantTx,
    operationId: string,
    objects: Omit<
      typeof fileOperationObjects.$inferInsert,
      "organizationId" | "operationId"
    >[]
  ) {
    await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    assertNotCommitted(operation)
    if (objects.length === 0) return []
    return tx
      .insert(fileOperationObjects)
      .values(
        objects.map((object) => ({
          ...object,
          organizationId: tx.context.organizationId,
          operationId,
        }))
      )
      .returning()
  },

  async recordPreparedObject(
    tx: TenantTx,
    operationId: string,
    objectId: string,
    facts: { bytes: number; sha256: string | null; transientBytes: number },
    leaseId?: string
  ) {
    const usage = await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    assertNotCommitted(operation)
    if (leaseId && operation.leaseId !== leaseId)
      fail("FILE_OPERATION_LEASE_CONFLICT")
    const [object] = await tx
      .select()
      .from(fileOperationObjects)
      .where(
        and(objectScope(tx, operationId), eq(fileOperationObjects.id, objectId))
      )
      .for("update")
    if (!object || !object.targetArea) fail("FILE_OPERATION_NOT_READY")
    if (
      !Number.isSafeInteger(facts.bytes) ||
      facts.bytes < 0 ||
      (!object.directory &&
        (!facts.sha256 || !/^[0-9a-f]{64}$/.test(facts.sha256))) ||
      facts.transientBytes < 0 ||
      !Number.isSafeInteger(facts.transientBytes) ||
      (object.expectedBytes !== null && object.expectedBytes !== facts.bytes) ||
      (object.expectedSha256 !== null && object.expectedSha256 !== facts.sha256)
    )
      fail("FILE_CONTENT_MISMATCH")
    if (object.preparedAt) {
      if (
        object.actualBytes !== facts.bytes ||
        object.actualSha256 !== facts.sha256
      )
        fail("FILE_CONTENT_MISMATCH")
      return object
    }
    const [updated] = await tx
      .update(fileOperationObjects)
      .set({
        preparedAt: new Date(),
        actualBytes: facts.bytes,
        actualSha256: facts.sha256,
        transientBytes: facts.transientBytes,
      })
      .where(
        and(objectScope(tx, operationId), eq(fileOperationObjects.id, objectId))
      )
      .returning()
    await tx
      .update(fileStorageUsage)
      .set({ transientBytes: usage.transientBytes + facts.transientBytes })
      .where(eq(fileStorageUsage.organizationId, tx.context.organizationId))
    return updated!
  },

  async prepareFolder(
    tx: TenantTx,
    operationId: string,
    input: { id: string; parentId: string; name: string }
  ) {
    await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    assertNotCommitted(operation)
    if (operation.action !== "create-folder") fail("FILE_OPERATION_NOT_READY")
    assertName(input.name, "folder")
    const folder = await requireFolder(tx, input.parentId, operationId)
    const path = [...folder.path, input.name]
    assertPath(path)
    const existing = await operationObjects(tx, operationId)
    if (existing.length) return { path, objects: existing }
    await assertAvailable(tx, input.parentId, input.name, operationId)
    await reserveNamespace(tx, operationId, input.parentId, input.name)
    return {
      path,
      objects: await this.addObjects(tx, operationId, [
        {
          entryId: input.id,
          directory: true,
          targetArea: "files",
          targetPath: path,
          expectedBytes: 0,
        },
      ]),
    }
  },

  async commitFolder(
    tx: TenantTx,
    operationId: string,
    input: { id: string; parentId: string; name: string }
  ) {
    await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    if (operation.committedAt) return findEntry(tx, input.id)
    assertNotCommitted(operation)
    if (operation.action !== "create-folder") fail("FILE_OPERATION_NOT_READY")
    const parent = await requireFolder(tx, input.parentId, operationId)
    const path = [...parent.path, input.name]
    const objects = await assertPrepared(tx, operation)
    if (
      !objects.some(
        (object) =>
          object.entryId === input.id &&
          object.directory &&
          object.targetArea === "files" &&
          JSON.stringify(object.targetPath) === JSON.stringify(path)
      )
    )
      fail("FILE_OPERATION_NOT_READY")
    await assertAvailable(tx, input.parentId, input.name, operationId)
    const [entry] = await tx
      .insert(fileEntries)
      .values({
        ...input,
        organizationId: tx.context.organizationId,
        kind: "folder",
        path,
        createdBy: tx.context.userId,
        busyOperationId: operationId,
      })
      .returning()
    const now = new Date()
    await recordAudit(tx, {
      eventCode: "folder.created",
      resourceType: "folder",
      resourceId: entry!.id,
      operationId,
    })
    await tx
      .update(fileOperations)
      .set({
        phase: "committed",
        committedAt: now,
        updatedAt: now,
        result: { entryId: entry!.id, revision: entry!.revision },
      })
      .where(operationScope(tx, operationId))
    return entry!
  },

  async commitUpload(
    tx: TenantTx,
    operationId: string,
    input: {
      fileId: string
      versionId: string
      objectId: string
      parentId: string
      name: string
      contentType: string
      expectedRevision?: number
    }
  ) {
    const usage = await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    if (operation.committedAt) return findEntry(tx, input.fileId)
    assertNotCommitted(operation)
    if (operation.action !== "upload" && operation.action !== "overwrite")
      fail("FILE_OPERATION_NOT_READY")
    const folder = await requireFolder(tx, input.parentId, operationId)
    const path = [...folder.path, input.name]
    const objects = await assertPrepared(tx, operation)
    const object = objects.find((candidate) => candidate.id === input.objectId)
    if (
      !object ||
      object.entryId !== input.fileId ||
      object.versionId !== input.versionId ||
      object.directory ||
      object.targetArea !== "files" ||
      JSON.stringify(object.targetPath) !== JSON.stringify(path) ||
      object.actualBytes !== operation.reservedBytes ||
      !object.actualSha256
    )
      fail("FILE_OPERATION_NOT_READY")
    let file: FileEntry
    const now = new Date()
    if (operation.action === "overwrite") {
      file = await requireEntry(tx, input.fileId)
      assertRevision(file, input.expectedRevision!)
      if (
        file.busyOperationId !== operationId ||
        file.parentId !== input.parentId ||
        file.name !== input.name ||
        !file.currentVersionId
      )
        fail("FILE_OPERATION_NOT_READY")
      const [previous] = await tx
        .select()
        .from(fileVersions)
        .where(
          and(
            eq(fileVersions.organizationId, tx.context.organizationId),
            eq(fileVersions.id, file.currentVersionId),
            eq(fileVersions.fileId, file.id)
          )
        )
        .for("update")
      const archive = objects.find(
        (candidate) =>
          candidate.versionId === previous?.id &&
          candidate.targetArea === "history" &&
          candidate.preparedAt
      )
      if (
        !previous ||
        !archive?.targetPath ||
        archive.actualSha256 !== previous.sha256 ||
        archive.actualBytes !== previous.bytes
      )
        fail("FILE_OPERATION_NOT_READY")
      await tx
        .update(fileVersions)
        .set({
          storageArea: "history",
          storagePath: archive.targetPath,
          archivedPath: file.path,
          retiredAt: now,
          expiresAt: new Date(now.getTime() + usage.historyDays * 86_400_000),
        })
        .where(
          and(
            eq(fileVersions.organizationId, tx.context.organizationId),
            eq(fileVersions.id, previous.id)
          )
        )
    } else {
      await assertAvailable(tx, input.parentId, input.name, operationId)
      const [created] = await tx
        .insert(fileEntries)
        .values({
          id: input.fileId,
          organizationId: tx.context.organizationId,
          parentId: input.parentId,
          name: input.name,
          kind: "file",
          path,
          createdBy: tx.context.userId,
          busyOperationId: operationId,
        })
        .returning()
      file = created!
    }
    await tx.insert(fileVersions).values({
      id: input.versionId,
      organizationId: tx.context.organizationId,
      fileId: file.id,
      bytes: object.actualBytes,
      sha256: object.actualSha256,
      contentType: input.contentType,
      storageArea: "files",
      storagePath: path,
      createdBy: tx.context.userId,
    })
    const [updated] = await tx
      .update(fileEntries)
      .set({
        currentVersionId: input.versionId,
        revision:
          operation.action === "overwrite" ? file.revision + 1 : file.revision,
        updatedAt: now,
      })
      .where(and(entryScope(tx), eq(fileEntries.id, file.id)))
      .returning()
    await tx
      .update(fileStorageUsage)
      .set({
        usedBytes: usage.usedBytes + object.actualBytes,
        reservedBytes: usage.reservedBytes - operation.reservedBytes,
      })
      .where(eq(fileStorageUsage.organizationId, tx.context.organizationId))
    await recordAudit(tx, {
      eventCode:
        operation.action === "overwrite" ? "file.overwritten" : "file.uploaded",
      resourceType: "file",
      resourceId: file.id,
      operationId,
      fields: { versionId: input.versionId, bytes: object.actualBytes },
    })
    await tx
      .update(fileOperations)
      .set({
        phase: "committed",
        committedAt: now,
        updatedAt: now,
        reservedBytes: 0,
        result: {
          entryId: file.id,
          versionId: input.versionId,
          revision: updated!.revision,
        },
      })
      .where(operationScope(tx, operationId))
    return updated!
  },

  async entryImpact(tx: TenantTx, entryId: string, action: "trash" | "purge") {
    await lockOrganization(tx)
    const root = await requireEntry(tx, entryId)
    if (!root.parentId) fail("FILE_ROOT_PROTECTED")
    if (root.state !== (action === "trash" ? "active" : "trashed"))
      fail("FILE_NOT_FOUND")
    const affected = root.kind === "folder" ? await subtree(tx, root) : [root]
    const busy = affected.find((entry) => entry.busyOperationId)
    if (busy)
      fail("FILE_OPERATION_IN_PROGRESS", { operationId: busy.busyOperationId })
    const files = affected.filter((entry) => entry.kind === "file")
    const ids = files.map((entry) => entry.id)
    const [versions] = await tx
      .select({
        bytes: sql`coalesce(sum(${fileVersions.bytes}),0)`.mapWith(Number),
      })
      .from(fileVersions)
      .where(
        and(
          eq(fileVersions.organizationId, tx.context.organizationId),
          inArray(fileVersions.fileId, ids),
          isNull(fileVersions.purgedAt)
        )
      )
    const [references] = await tx
      .select({ total: count() })
      .from(fileReferences)
      .where(
        and(
          eq(fileReferences.organizationId, tx.context.organizationId),
          inArray(fileReferences.fileId, ids)
        )
      )
    return {
      entryId: root.id,
      revision: root.revision,
      fileCount: files.length,
      folderCount: affected.length - files.length,
      bytes: versions!.bytes,
      referenceCount: references!.total,
    }
  },

  async preparePathOperation(
    tx: TenantTx,
    operationId: string,
    input: {
      entryId: string
      expectedRevision: number
      selected?: { entryId: string; expectedRevision: number }[]
      parentId?: string
      name?: string
      now: Date
    }
  ) {
    const usage = await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    assertNotCommitted(operation)
    if (
      !["rename", "move", "trash", "restore", "purge"].includes(
        operation.action
      )
    )
      fail("FILE_OPERATION_NOT_READY")
    if (operation.plans.length)
      return {
        plans: operation.plans,
        objects: await operationObjects(tx, operationId),
      }
    const root = await requireEntry(tx, input.entryId)
    if (!root.parentId) fail("FILE_ROOT_PROTECTED")
    assertRevision(root, input.expectedRevision)
    if (root.busyOperationId && root.busyOperationId !== operationId)
      fail("FILE_OPERATION_IN_PROGRESS", { operationId: root.busyOperationId })
    const restoring = operation.action === "restore"
    const purging = operation.action === "purge"
    const trashing = operation.action === "trash"
    if (
      restoring || purging ? root.state !== "trashed" : root.state !== "active"
    )
      fail("FILE_NOT_FOUND")
    if (restoring && (!root.expiresAt || root.expiresAt <= input.now))
      fail("FILE_RESTORE_EXPIRED")
    // 同一源/目标不能进入复制后清理链；revision 和生命周期冲突仍先于空变更。
    if (
      (operation.action === "rename" && input.name === root.name) ||
      (operation.action === "move" && input.parentId === root.parentId)
    )
      fail("VALIDATION_ERROR")
    const affected = root.kind === "folder" ? await subtree(tx, root) : [root]
    // 已被祖先覆盖的显式选择仍受原 revision 约束；重试不能把移出的子项重新解释为另一个根。
    for (const selected of input.selected ?? []) {
      const entry = affected.find((entry) => entry.id === selected.entryId)
      if (!entry) fail("VERSION_CONFLICT")
      assertRevision(entry, selected.expectedRevision)
    }
    const busy = affected.find(
      (entry) => entry.busyOperationId && entry.busyOperationId !== operationId
    )
    if (busy)
      fail("FILE_OPERATION_IN_PROGRESS", { operationId: busy.busyOperationId })
    const [childReservation] = await tx
      .select()
      .from(fileNamespaceReservations)
      .where(
        and(
          eq(
            fileNamespaceReservations.organizationId,
            tx.context.organizationId
          ),
          inArray(
            fileNamespaceReservations.parentId,
            affected.map((entry) => entry.id)
          ),
          ne(fileNamespaceReservations.operationId, operationId)
        )
      )
      .limit(1)
    if (childReservation)
      fail("FILE_OPERATION_IN_PROGRESS", {
        operationId: childReservation.operationId,
      })
    if (trashing || purging)
      await assertNoReferences(
        tx,
        affected
          .filter((entry) => entry.kind === "file")
          .map((entry) => entry.id)
      )
    const parentId = input.parentId ?? root.parentId
    const name = input.name ?? root.name
    assertName(name, root.kind)
    let parent: FileEntry | undefined
    if (!trashing && !purging) {
      if (affected.some((entry) => entry.id === parentId))
        fail("FILE_FOLDER_CYCLE")
      parent = await requireFolder(tx, parentId, operationId)
      await assertAvailable(tx, parentId, name, operationId, root.id)
    }
    const rootPath = parent ? [...parent.path, name] : root.path
    const expiresAt = trashing
      ? new Date(
          input.now.getTime() + usage.trashDays * 86_400_000
        ).toISOString()
      : null
    const plans: FileEntryPlan[] = affected.map((entry) => {
      const path = parent
        ? [...rootPath, ...entry.path.slice(root.path.length)]
        : entry.path
      assertPath(path)
      return {
        id: entry.id,
        expectedRevision: entry.revision,
        previousParentId: entry.parentId,
        parentId: entry.id === root.id ? parentId : entry.parentId,
        previousName: entry.name,
        name: entry.id === root.id ? name : entry.name,
        previousPath: entry.path,
        path,
        previousState: entry.state,
        state: trashing ? "trashed" : purging ? "purged" : "active",
        trashRootId: trashing ? root.id : null,
        deletedAt: trashing ? input.now.toISOString() : null,
        expiresAt,
      }
    })
    await reserveNamespace(tx, operationId, root.parentId, root.name)
    if (parent) await reserveNamespace(tx, operationId, parentId, name)
    await tx
      .update(fileEntries)
      .set({ busyOperationId: operationId })
      .where(
        and(
          entryScope(tx),
          inArray(
            fileEntries.id,
            affected.map((entry) => entry.id)
          )
        )
      )
    await tx
      .update(fileOperations)
      .set({ plans, phase: "preparing", updatedAt: input.now })
      .where(operationScope(tx, operationId))
    const objects: Omit<
      typeof fileOperationObjects.$inferInsert,
      "organizationId" | "operationId"
    >[] = []
    if (root.kind === "file" && trashing)
      objects.push({
        entryId: null,
        directory: true,
        targetArea: "trash",
        targetPath: [root.id],
        expectedBytes: 0,
      })
    for (const entry of affected) {
      const plan = plans.find((candidate) => candidate.id === entry.id)!
      if (entry.kind === "folder") {
        const sourceArea = entry.state === "active" ? "files" : "trash"
        const sourcePath =
          entry.state === "active"
            ? entry.path
            : entry.id === entry.trashRootId
              ? [entry.id]
              : [entry.trashRootId!, entry.id]
        objects.push({
          entryId: entry.id,
          directory: true,
          sourceArea,
          sourcePath,
          targetArea: purging ? null : trashing ? "trash" : "files",
          targetPath: purging
            ? null
            : trashing
              ? entry.id === root.id
                ? [root.id]
                : [root.id, entry.id]
              : plan.path,
          expectedBytes: 0,
        })
      } else {
        const versions = await tx
          .select()
          .from(fileVersions)
          .where(
            and(
              eq(fileVersions.organizationId, tx.context.organizationId),
              eq(fileVersions.fileId, entry.id),
              isNull(fileVersions.purgedAt),
              purging ? undefined : eq(fileVersions.id, entry.currentVersionId!)
            )
          )
          .for("update")
        for (const version of versions)
          objects.push({
            entryId: entry.id,
            versionId: version.id,
            directory: false,
            sourceArea: version.storageArea,
            sourcePath: version.storagePath,
            targetArea: purging ? null : trashing ? "trash" : "files",
            targetPath: purging
              ? null
              : trashing
                ? [root.id, version.id]
                : plan.path,
            expectedBytes: version.bytes,
            expectedSha256: version.sha256,
          })
      }
    }
    // 只有独立 file 回收批次拥有这个根；从 folder 批次摘出文件不能删除共享根。
    if (
      root.kind === "file" &&
      (restoring || purging) &&
      root.trashRootId === root.id
    )
      objects.push({
        entryId: null,
        directory: true,
        sourceArea: "trash",
        sourcePath: [root.id],
        expectedBytes: 0,
      })
    return { plans, objects: await this.addObjects(tx, operationId, objects) }
  },

  async commitPathOperation(tx: TenantTx, operationId: string, now: Date) {
    const usage = await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    if (operation.committedAt) return operation
    assertNotCommitted(operation)
    const objects = await assertPrepared(tx, operation)
    if (operation.plans.length === 0) fail("FILE_OPERATION_NOT_READY")
    const purging = operation.action === "purge"
    if (
      purging &&
      objects.some((object) => object.sourceArea && !object.sourceDeletedAt)
    )
      fail("FILE_OPERATION_NOT_READY")
    const entries = []
    for (const plan of operation.plans) {
      const entry = await requireEntry(tx, plan.id)
      if (!entry.parentId) fail("FILE_ROOT_PROTECTED")
      assertRevision(entry, plan.expectedRevision)
      if (entry.busyOperationId !== operationId)
        fail("FILE_OPERATION_NOT_READY")
      entries.push(entry)
    }
    if (operation.action === "trash" || purging)
      await assertNoReferences(
        tx,
        entries
          .filter((entry) => entry.kind === "file")
          .map((entry) => entry.id)
      )
    if (
      operation.action === "restore" &&
      entries.some((entry) => !entry.expiresAt || entry.expiresAt <= now)
    )
      fail("FILE_RESTORE_EXPIRED")
    for (const plan of operation.plans)
      await tx
        .update(fileEntries)
        .set({
          parentId: plan.parentId,
          name: plan.name,
          path: plan.path,
          state: plan.state,
          revision: plan.expectedRevision + 1,
          trashRootId: plan.trashRootId,
          deletedAt: plan.deletedAt ? new Date(plan.deletedAt) : null,
          expiresAt: plan.expiresAt ? new Date(plan.expiresAt) : null,
          updatedAt: now,
        })
        .where(and(entryScope(tx), eq(fileEntries.id, plan.id)))
    let purgedBytes = 0
    for (const object of objects)
      if (object.versionId) {
        if (!object.entryId) fail("FILE_OPERATION_NOT_READY")
        const [version] = await tx
          .select()
          .from(fileVersions)
          .where(
            and(
              eq(fileVersions.organizationId, tx.context.organizationId),
              eq(fileVersions.id, object.versionId),
              eq(fileVersions.fileId, object.entryId)
            )
          )
          .for("update")
        if (!version) throw new Error("Operation version is missing")
        if (purging) {
          if (!version.purgedAt) {
            purgedBytes += version.bytes
            await tx
              .update(fileVersions)
              .set({ purgedAt: now })
              .where(
                and(
                  eq(fileVersions.organizationId, tx.context.organizationId),
                  eq(fileVersions.id, version.id)
                )
              )
          }
        } else if (object.targetArea && object.targetPath) {
          await tx
            .update(fileVersions)
            .set({
              storageArea: object.targetArea,
              storagePath: object.targetPath,
              archivedPath:
                operation.action === "trash"
                  ? entries.find((entry) => entry.id === object.entryId)!.path
                  : version.archivedPath,
            })
            .where(
              and(
                eq(fileVersions.organizationId, tx.context.organizationId),
                eq(fileVersions.id, version.id)
              )
            )
        }
      }
    if (purgedBytes)
      await tx
        .update(fileStorageUsage)
        .set({ usedBytes: usage.usedBytes - purgedBytes })
        .where(eq(fileStorageUsage.organizationId, tx.context.organizationId))
    const root = entries[0]!
    await recordAudit(tx, {
      eventCode: `${root.kind}.${operation.action === "trash" ? "trashed" : operation.action === "purge" ? "purged" : operation.action === "restore" ? "restored" : operation.action === "rename" ? "renamed" : "moved"}`,
      resourceType: root.kind,
      resourceId: root.id,
      operationId,
      fields: { affectedEntries: entries.length },
    })
    const [committed] = await tx
      .update(fileOperations)
      .set({
        phase: "committed",
        committedAt: now,
        updatedAt: now,
        result: {
          entryId: root.id,
          revision: root.revision + 1,
          affectedEntries: entries.length,
        },
      })
      .where(operationScope(tx, operationId))
      .returning()
    return committed!
  },

  async recordSourceDeletionIntent(
    tx: TenantTx,
    operationId: string,
    objectId: string,
    leaseId: string
  ) {
    await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    assertNotCommitted(operation)
    const [{ now }] = (await tx.execute(sql`SELECT clock_timestamp() AS now`))
      .rows as { now: Date | string }[]
    if (
      operation.action !== "overwrite" ||
      operation.actorType !== "user" ||
      operation.actorId !== tx.context.userId ||
      operation.completedAt ||
      operation.phase === "failed"
    )
      fail("FILE_OPERATION_NOT_READY")
    if (
      operation.leaseId !== leaseId ||
      !operation.leaseExpiresAt ||
      operation.leaseExpiresAt.getTime() <= new Date(now!).getTime()
    )
      fail("FILE_OPERATION_LEASE_CONFLICT")
    const [object] = await tx
      .select()
      .from(fileOperationObjects)
      .where(
        and(objectScope(tx, operationId), eq(fileOperationObjects.id, objectId))
      )
      .for("update")
    if (
      !object ||
      object.directory ||
      !object.versionId ||
      object.sourceArea !== "files" ||
      object.targetArea !== "history" ||
      !object.preparedAt ||
      object.sourceDeletedAt ||
      object.targetDeletedAt ||
      object.sourceRestoredAt ||
      object.expectedBytes === null ||
      object.expectedSha256 === null ||
      object.actualBytes !== object.expectedBytes ||
      object.actualSha256 !== object.expectedSha256
    )
      fail("FILE_OPERATION_NOT_READY")
    const file = object.entryId
      ? await requireEntry(tx, object.entryId)
      : undefined
    const [version] = await tx
      .select()
      .from(fileVersions)
      .where(
        and(
          eq(fileVersions.organizationId, tx.context.organizationId),
          eq(fileVersions.id, object.versionId!)
        )
      )
      .for("share")
    if (
      !file ||
      file.kind !== "file" ||
      file.state !== "active" ||
      file.busyOperationId !== operationId ||
      file.currentVersionId !== object.versionId ||
      !version ||
      version.storageArea !== object.sourceArea ||
      JSON.stringify(version.storagePath) !==
        JSON.stringify(object.sourcePath) ||
      version.bytes !== object.expectedBytes ||
      version.sha256 !== object.expectedSha256
    )
      fail("FILE_OPERATION_NOT_READY")
    if (object.sourceDeletionStartedAt) return
    // 这是旧源删除的授权意图；删除响应未知时，维护必须先核实/恢复旧源再释放已验证备份。
    await tx
      .update(fileOperationObjects)
      .set({ sourceDeletionStartedAt: new Date(now!) })
      .where(
        and(objectScope(tx, operationId), eq(fileOperationObjects.id, objectId))
      )
  },

  async recordObjectDeleted(
    tx: TenantTx,
    operationId: string,
    objectId: string,
    side: "source" | "target",
    now: Date
  ) {
    const usage = await lockOrganization(tx)
    await requireOperation(tx, operationId)
    const [object] = await tx
      .select()
      .from(fileOperationObjects)
      .where(
        and(objectScope(tx, operationId), eq(fileOperationObjects.id, objectId))
      )
      .for("update")
    if (!object) fail("FILE_OPERATION_NOT_FOUND")
    const previous =
      side === "source" ? object.sourceDeletedAt : object.targetDeletedAt
    if (
      side === "target" &&
      object.sourceDeletionStartedAt &&
      !object.sourceRestoredAt
    )
      fail("FILE_OPERATION_NOT_READY")
    if (previous) return
    await tx
      .update(fileOperationObjects)
      .set(
        side === "source"
          ? { sourceDeletedAt: now, transientBytes: 0 }
          : { targetDeletedAt: now, transientBytes: 0 }
      )
      .where(
        and(objectScope(tx, operationId), eq(fileOperationObjects.id, objectId))
      )
    // 临时占用只在该精确副本的删除事实首次落库时释放。
    await tx
      .update(fileStorageUsage)
      .set({ transientBytes: usage.transientBytes - object.transientBytes })
      .where(eq(fileStorageUsage.organizationId, tx.context.organizationId))
  },

  async recordSourceRestored(
    tx: TenantTx,
    operationId: string,
    objectId: string,
    facts: { bytes: number; sha256: string | null },
    now: Date
  ) {
    const usage = await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    assertNotCommitted(operation)
    if (operation.action === "purge") fail("FILE_OPERATION_NOT_READY")
    const [object] = await tx
      .select()
      .from(fileOperationObjects)
      .where(
        and(objectScope(tx, operationId), eq(fileOperationObjects.id, objectId))
      )
      .for("update")
    if (
      !object ||
      (!object.sourceDeletionStartedAt && !object.sourceDeletedAt) ||
      object.expectedBytes !== facts.bytes ||
      (object.expectedSha256 !== null && object.expectedSha256 !== facts.sha256)
    )
      fail("FILE_CONTENT_MISMATCH")
    if (object.sourceRestoredAt) return
    const transientBytes = object.targetDeletedAt ? 0 : facts.bytes
    await tx
      .update(fileOperationObjects)
      .set({ sourceRestoredAt: now, transientBytes })
      .where(
        and(objectScope(tx, operationId), eq(fileOperationObjects.id, objectId))
      )
    await tx
      .update(fileStorageUsage)
      .set({
        transientBytes:
          usage.transientBytes + transientBytes - object.transientBytes,
      })
      .where(eq(fileStorageUsage.organizationId, tx.context.organizationId))
  },

  async finishOperation(tx: TenantTx, operationId: string, now: Date) {
    await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    if (operation.completedAt) return operation
    if (!operation.committedAt) fail("FILE_OPERATION_NOT_READY")
    const objects = await operationObjects(tx, operationId)
    if (
      objects.some(
        (object) =>
          (object.sourceArea && !object.sourceDeletedAt) ||
          (object.targetArea === "staging" && !object.targetDeletedAt)
      )
    )
      fail("FILE_OPERATION_NOT_READY")
    await tx
      .delete(fileNamespaceReservations)
      .where(
        and(
          eq(
            fileNamespaceReservations.organizationId,
            tx.context.organizationId
          ),
          eq(fileNamespaceReservations.operationId, operationId)
        )
      )
    await tx
      .update(fileEntries)
      .set({ busyOperationId: null })
      .where(and(entryScope(tx), eq(fileEntries.busyOperationId, operationId)))
    const [completed] = await tx
      .update(fileOperations)
      .set({
        phase: "completed",
        completedAt: now,
        updatedAt: now,
        leaseId: null,
        leaseExpiresAt: null,
        errorCode: null,
      })
      .where(operationScope(tx, operationId))
      .returning()
    return completed!
  },

  async recordOperationError(
    tx: TenantTx,
    operationId: string,
    errorCode: string,
    now: Date
  ) {
    await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    if (operation.completedAt || operation.phase === "failed") return operation
    const [updated] = await tx
      .update(fileOperations)
      .set({
        phase: operation.committedAt ? "cleaning" : "preparing",
        errorCode,
        updatedAt: now,
      })
      .where(operationScope(tx, operationId))
      .returning()
    return updated!
  },

  async failOperation(
    tx: TenantTx,
    operationId: string,
    errorCode: string,
    now: Date
  ) {
    const usage = await lockOrganization(tx)
    const operation = await requireOperation(tx, operationId)
    if (operation.completedAt) return operation
    if (operation.committedAt) {
      const [failed] = await tx
        .update(fileOperations)
        .set({
          phase: "cleaning",
          errorCode,
          updatedAt: now,
          leaseId: null,
          leaseExpiresAt: null,
        })
        .where(operationScope(tx, operationId))
        .returning()
      return failed!
    }
    // 已准备的永久删除意图由系统继续完成，不能按可恢复操作释放事实。
    if (operation.action === "purge" && operation.plans.length)
      fail("FILE_OPERATION_NOT_READY")
    const objects = await operationObjects(tx, operationId)
    if (
      objects.some(
        (object) =>
          (object.targetArea && !object.targetDeletedAt) ||
          ((object.sourceDeletionStartedAt || object.sourceDeletedAt) &&
            !object.sourceRestoredAt)
      )
    )
      fail("FILE_OPERATION_NOT_READY")
    await tx
      .update(fileStorageUsage)
      .set({ reservedBytes: usage.reservedBytes - operation.reservedBytes })
      .where(eq(fileStorageUsage.organizationId, tx.context.organizationId))
    await tx
      .delete(fileNamespaceReservations)
      .where(
        and(
          eq(
            fileNamespaceReservations.organizationId,
            tx.context.organizationId
          ),
          eq(fileNamespaceReservations.operationId, operationId)
        )
      )
    await tx
      .update(fileEntries)
      .set({ busyOperationId: null })
      .where(and(entryScope(tx), eq(fileEntries.busyOperationId, operationId)))
    const [failed] = await tx
      .update(fileOperations)
      .set({
        phase: "failed",
        errorCode,
        reservedBytes: 0,
        updatedAt: now,
        leaseId: null,
        leaseExpiresAt: null,
      })
      .where(operationScope(tx, operationId))
      .returning()
    return failed!
  },

  projectAttachments(tx: TenantTx, projectId: string) {
    return tx
      .select({
        fileId: fileReferences.fileId,
        versionId: fileReferences.versionId,
        name: fileEntries.name,
        bytes: fileVersions.bytes,
        contentType: fileVersions.contentType,
        versionCreatedAt: fileVersions.createdAt,
      })
      .from(fileReferences)
      .innerJoin(
        fileEntries,
        and(
          eq(fileEntries.organizationId, fileReferences.organizationId),
          eq(fileEntries.id, fileReferences.fileId)
        )
      )
      .innerJoin(
        fileVersions,
        and(
          eq(fileVersions.organizationId, fileReferences.organizationId),
          eq(fileVersions.fileId, fileReferences.fileId),
          eq(fileVersions.id, fileReferences.versionId)
        )
      )
      .where(
        and(
          eq(fileReferences.organizationId, tx.context.organizationId),
          eq(fileReferences.projectId, projectId),
          eq(fileReferences.kind, "project_attachment"),
          isNull(fileReferences.locale)
        )
      )
      .orderBy(asc(fileReferences.position), asc(fileReferences.id))
  },

  async references(tx: TenantTx, fileId: string) {
    return tx
      .select()
      .from(fileReferences)
      .where(
        and(
          eq(fileReferences.organizationId, tx.context.organizationId),
          eq(fileReferences.fileId, fileId)
        )
      )
      .orderBy(asc(fileReferences.position), asc(fileReferences.id))
  },

  async replaceReferences(
    tx: TenantTx,
    business: FileReferenceBusiness,
    input: FileReferenceInput[]
  ) {
    await lockOrganization(tx)
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, tx.context.organizationId),
          eq(projects.id, business.projectId)
        )
      )
      .for("update")
    if (!project) fail("PROJECT_NOT_FOUND")
    for (const reference of input)
      await this.findVersion(tx, reference.fileId, reference.versionId, "share")
    const locale =
      business.locale === null
        ? isNull(fileReferences.locale)
        : eq(fileReferences.locale, business.locale)
    await tx
      .delete(fileReferences)
      .where(
        and(
          eq(fileReferences.organizationId, tx.context.organizationId),
          eq(fileReferences.projectId, business.projectId),
          eq(fileReferences.kind, business.kind),
          locale
        )
      )
    if (input.length)
      await tx.insert(fileReferences).values(
        input.map((reference) => ({
          ...reference,
          ...business,
          organizationId: tx.context.organizationId,
        }))
      )
  },

  async findProjectContent(
    tx: TenantTx,
    projectId: string,
    locale: "zh-CN" | "en-US" | "ar"
  ) {
    const [content] = await tx
      .select()
      .from(projectFileContents)
      .where(
        and(
          eq(projectFileContents.organizationId, tx.context.organizationId),
          eq(projectFileContents.projectId, projectId),
          eq(projectFileContents.locale, locale)
        )
      )
    return content
  },

  async saveProjectContent(
    tx: TenantTx,
    business: FileReferenceBusiness & {
      kind: "project_rich_text"
      locale: "zh-CN" | "en-US" | "ar"
    },
    input: {
      expectedRevision: number | null
      document: Record<string, unknown>
      references: FileReferenceInput[]
    }
  ) {
    await lockOrganization(tx)
    const current = await this.findProjectContent(
      tx,
      business.projectId,
      business.locale
    )
    if ((current?.revision ?? null) !== input.expectedRevision)
      fail("VERSION_CONFLICT", { revision: current?.revision ?? null })
    await this.replaceReferences(tx, business, input.references)
    const [content] = await tx
      .insert(projectFileContents)
      .values({
        organizationId: tx.context.organizationId,
        projectId: business.projectId,
        locale: business.locale,
        document: input.document,
        revision: 1,
      })
      .onConflictDoUpdate({
        target: [
          projectFileContents.organizationId,
          projectFileContents.projectId,
          projectFileContents.locale,
        ],
        set: {
          document: input.document,
          revision: (current?.revision ?? 0) + 1,
          updatedAt: new Date(),
        },
      })
      .returning()
    return content!
  },
}
