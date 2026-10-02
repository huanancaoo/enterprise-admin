import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"
import { eq, sql } from "drizzle-orm"
import { Pool } from "pg"
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers"
import { afterAll, beforeAll, test } from "vitest"
import {
  createTenantRunner,
  type TenantContext,
  type TenantTx,
} from "../src/tenant.ts"
import {
  fileRepository,
  FileRepositoryError,
  type FileEntry,
  type FileOperationObject,
} from "../src/repositories/files.ts"
import { projectRepository } from "../src/repositories/projects.ts"
import { fileEntries } from "../src/schema/files.ts"

let container: StartedTestContainer | undefined
let owner: Pool
let runtime: Pool
let run: ReturnType<typeof createTenantRunner>
const tables = [
  "file_entries",
  "file_versions",
  "file_references",
  "file_storage_usage",
  "file_operations",
  "file_operation_objects",
  "file_namespace_reservations",
  "project_file_contents",
]
const sha = (body: string | Buffer) =>
  createHash("sha256").update(body).digest("hex")
const errorCode = (expected: string) => (error: unknown) =>
  error instanceof FileRepositoryError && error.code === expected
const sqlCode = (expected: string) => (error: unknown) => {
  const value = error as { code?: string; cause?: { code?: string } }
  return (value.cause?.code ?? value.code) === expected
}

beforeAll(async () => {
  const versions = JSON.parse(
    await readFile("../../docs/architecture/versions.json", "utf8")
  )
  const passwords = Array.from({ length: 5 }, () =>
    randomBytes(24).toString("hex")
  )
  container = await new GenericContainer(versions.postgresql.image)
    .withEnvironment({
      POSTGRES_USER: "bootstrap_admin",
      POSTGRES_DB: "enterprise_admin",
      POSTGRES_PASSWORD: passwords[0]!,
      APP_MIGRATOR_PASSWORD: passwords[1]!,
      APP_RUNTIME_PASSWORD: passwords[2]!,
      PLATFORM_RUNTIME_PASSWORD: passwords[3]!,
      PLATFORM_DEPLOYER_PASSWORD: passwords[4]!,
    })
    .withCopyFilesToContainer([
      {
        source: resolve("../../infra/postgres/bootstrap.sql"),
        target: "/docker-entrypoint-initdb.d/001-bootstrap.sql",
      },
    ])
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections", 2)
    )
    .withStartupTimeout(120_000)
    .start()
  const url = (user: string, password: string) =>
    `postgresql://${user}:${password}@${container!.getHost()}:${container!.getMappedPort(5432)}/enterprise_admin`
  owner = new Pool({
    connectionString: url("bootstrap_admin", passwords[0]!),
    max: 2,
  })
  runtime = new Pool({
    connectionString: url("app_runtime", passwords[2]!),
    max: 8,
  })
  await promisify(execFile)(process.execPath, [resolve("src/migrate.ts")], {
    env: {
      PATH: process.env.PATH,
      MIGRATION_DATABASE_URL: url("app_migrator", passwords[1]!),
    },
  })
  run = createTenantRunner(runtime)
})
afterAll(async () => {
  try {
    await Promise.all([owner?.end(), runtime?.end()])
  } finally {
    await container?.stop()
  }
})

async function workspace() {
  const organizationId = randomUUID()
  const context: TenantContext = {
    organizationId,
    userId: randomUUID(),
    membershipId: randomUUID(),
    requestId: randomUUID(),
    locale: "zh-CN",
  }
  await owner.query(
    "INSERT INTO organization(id,name,slug,created_at) VALUES($1,$2,$2,now())",
    [organizationId, `files-${organizationId}`]
  )
  const { root, usage } = await run(
    context,
    fileRepository.ensureWorkspace,
    "write"
  )
  return { context, root, usage }
}
async function begin(
  tx: TenantTx,
  action:
    | "upload"
    | "overwrite"
    | "create-folder"
    | "rename"
    | "move"
    | "trash"
    | "restore"
    | "purge",
  input: Record<string, unknown> = {},
  id = randomUUID()
) {
  return (
    await fileRepository.beginOperation(tx, {
      id,
      action,
      requestHash: sha(JSON.stringify(input)),
      input,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
  ).operation
}
async function prepared(
  tx: TenantTx,
  operationId: string,
  objects: FileOperationObject[]
) {
  for (const object of objects)
    if (object.targetArea)
      await fileRepository.recordPreparedObject(tx, operationId, object.id, {
        bytes: object.expectedBytes ?? 0,
        sha256: object.expectedSha256,
        transientBytes: object.sourceArea ? (object.expectedBytes ?? 0) : 0,
      })
}
async function complete(
  tx: TenantTx,
  operationId: string,
  objects: FileOperationObject[]
) {
  for (const object of objects)
    if (object.sourceArea)
      await fileRepository.recordObjectDeleted(
        tx,
        operationId,
        object.id,
        "source",
        new Date()
      )
  return fileRepository.finishOperation(tx, operationId, new Date())
}
async function folder(context: TenantContext, parentId: string, name: string) {
  return run(
    context,
    async (tx) => {
      const operation = await begin(tx, "create-folder", { parentId, name })
      const input = { id: randomUUID(), parentId, name }
      const result = await fileRepository.prepareFolder(tx, operation.id, input)
      await prepared(tx, operation.id, result.objects)
      const entry = (await fileRepository.commitFolder(
        tx,
        operation.id,
        input
      ))!
      await complete(tx, operation.id, result.objects)
      return { ...entry, busyOperationId: null }
    },
    "write"
  )
}
async function upload(
  context: TenantContext,
  parentId: string,
  name: string,
  body = "abc"
) {
  return run(
    context,
    async (tx) => {
      const operation = await begin(tx, "upload", { parentId, name })
      const fileId = randomUUID(),
        versionId = randomUUID()
      await fileRepository.reserveUpload(tx, operation.id, {
        parentId,
        name,
        declaredBytes: Buffer.byteLength(body),
      })
      const parent = (await fileRepository.findEntry(tx, parentId))!
      const objects = await fileRepository.addObjects(tx, operation.id, [
        {
          entryId: fileId,
          versionId,
          directory: false,
          targetArea: "files",
          targetPath: [...parent.path, name],
          expectedBytes: Buffer.byteLength(body),
          expectedSha256: sha(body),
        },
      ])
      await prepared(tx, operation.id, objects)
      const entry = (await fileRepository.commitUpload(tx, operation.id, {
        fileId,
        versionId,
        objectId: objects[0]!.id,
        parentId,
        name,
        contentType: "text/plain",
      }))!
      await complete(tx, operation.id, objects)
      return { ...entry, busyOperationId: null }
    },
    "write"
  )
}
async function pathOperation(
  context: TenantContext,
  entry: FileEntry,
  action: "rename" | "move" | "trash" | "restore" | "purge",
  options: { parentId?: string; name?: string; now?: Date } = {}
) {
  return run(
    context,
    async (tx) => {
      const now = options.now ?? new Date()
      const operation = await begin(tx, action, {
        entryId: entry.id,
        ...options,
      })
      const result = await fileRepository.preparePathOperation(
        tx,
        operation.id,
        { ...options, entryId: entry.id, expectedRevision: entry.revision, now }
      )
      await prepared(tx, operation.id, result.objects)
      if (action === "purge")
        for (const object of result.objects)
          await fileRepository.recordObjectDeleted(
            tx,
            operation.id,
            object.id,
            "source",
            now
          )
      await fileRepository.commitPathOperation(tx, operation.id, now)
      await complete(tx, operation.id, result.objects)
      return (await fileRepository.findEntry(tx, entry.id))!
    },
    "write"
  )
}

// 这里验证正式 TenantTx 数据边界；物理写入/删除仍由 API + Local/RustFS 矩阵验证。
test("8张组织表启用并强制RLS，runtime不是owner且无旁路权限", async () => {
  const role = await runtime.query(
    "SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user"
  )
  assert.deepEqual(role.rows[0], {
    current_user: "app_runtime",
    rolsuper: false,
    rolbypassrls: false,
  })
  const rows = await runtime.query(
    "SELECT relname,relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname=ANY($1)",
    [tables]
  )
  assert.equal(rows.rowCount, 8)
  for (const row of rows.rows)
    assert.deepEqual(
      {
        rls: row.relrowsecurity,
        force: row.relforcerowsecurity,
        owner: row.owner,
      },
      { rls: true, force: true, owner: "app_migrator" }
    )
})

test("无上下文所有Files表不可读，组织策略列不能由runtime改写", async () => {
  for (const table of tables)
    assert.equal((await runtime.query(`SELECT * FROM ${table}`)).rowCount, 0)
  const a = await workspace()
  await assert.rejects(
    run(a.context, (tx) =>
      tx.execute(
        sql`UPDATE file_storage_usage SET quota_bytes=999999 WHERE organization_id=${a.context.organizationId}::uuid`
      )
    ),
    sqlCode("42501")
  )
  await assert.rejects(
    runtime.query(
      "INSERT INTO file_operations(id,organization_id,actor_id,action,request_hash,request_id,input,expires_at) VALUES($1,$2,$3,'upload',$4,'test','{}',now())",
      [randomUUID(), a.context.organizationId, a.context.userId, sha("a")]
    ),
    sqlCode("42501")
  )
})

test("固定root只初始化一次，默认策略是10GiB/30天/90天", async () => {
  const a = await workspace()
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      run(a.context, fileRepository.ensureWorkspace, "write")
    )
  )
  assert.ok(results.every((result) => result.root.id === a.root.id))
  assert.equal(a.usage.quotaBytes, 10 * 1024 ** 3)
  assert.equal(a.usage.trashDays, 30)
  assert.equal(a.usage.historyDays, 90)
  await assert.rejects(
    run(a.context, (tx) =>
      tx
        .update(fileEntries)
        .set({ name: "renamed" })
        .where(eq(fileEntries.id, a.root.id))
    ),
    sqlCode("23514")
  )
})

test("共享同级命名空间区分大小写且层级、分页、搜索、面包屑正确", async () => {
  const a = await workspace()
  const contract = await folder(a.context, a.root.id, "合同")
  await folder(a.context, a.root.id, "CONTRACT")
  await folder(a.context, a.root.id, "contract")
  await upload(a.context, contract.id, "资料.txt")
  await assert.rejects(
    upload(a.context, a.root.id, "合同"),
    errorCode("FILE_NAME_CONFLICT")
  )
  const page = await run(a.context, (tx) =>
    fileRepository.listPage(tx, {
      parentId: a.root.id,
      state: "active",
      page: 1,
      pageSize: 2,
      sortBy: "name",
      sortOrder: "asc",
    })
  )
  assert.equal(page.total, 3)
  assert.equal(page.items.length, 2)
  const search = await run(a.context, (tx) =>
    fileRepository.listPage(tx, {
      state: "active",
      name: "资料",
      page: 1,
      pageSize: 20,
      sortBy: "updatedAt",
      sortOrder: "desc",
    })
  )
  assert.equal(search.total, 1)
  assert.deepEqual(search.items[0]!.entry.path, ["合同", "资料.txt"])
  assert.deepEqual(
    (
      await run(a.context, (tx) => fileRepository.breadcrumbs(tx, contract.id))
    ).map((entry) => entry.id),
    [a.root.id, contract.id]
  )
})

test("目录246字节、文件255字节、总路径512字节边界一致，非法名称被拒绝", async () => {
  const a = await workspace()
  const long = await folder(a.context, a.root.id, "a".repeat(246))
  const child = await folder(a.context, long.id, "b".repeat(9))
  const file = await upload(a.context, child.id, "c".repeat(255))
  assert.equal(Buffer.byteLength(file.path.join("/")), 512)
  await assert.rejects(
    folder(a.context, a.root.id, "a".repeat(247)),
    errorCode("FILE_NAME_TOO_LONG")
  )
  await assert.rejects(
    upload(a.context, child.id, "x".repeat(256)),
    errorCode("FILE_NAME_TOO_LONG")
  )
  const deeper = await folder(a.context, child.id, "d".repeat(246))
  await assert.rejects(
    folder(a.context, deeper.id, "e".repeat(9)),
    errorCode("FILE_PATH_TOO_LONG")
  )
  for (const name of [
    "",
    ".",
    "..",
    "a/b",
    "a\\b",
    "a%252fB",
    " a",
    "e\u0301",
    "a\u0001b",
  ])
    await assert.rejects(
      folder(a.context, a.root.id, name),
      errorCode("FILE_NAME_INVALID")
    )
})

test("跨组织资源查询、写入与复合外键均拒绝，事务上下文不会泄漏", async () => {
  const a = await workspace(),
    b = await workspace()
  const file = await upload(a.context, a.root.id, "private.txt")
  assert.equal(
    await run(b.context, (tx) => fileRepository.findEntry(tx, file.id)),
    undefined
  )
  await assert.rejects(
    run(b.context, (tx) =>
      fileRepository.findVersion(tx, file.id, file.currentVersionId!)
    ),
    errorCode("FILE_NOT_FOUND")
  )
  await assert.rejects(
    run(a.context, (tx) =>
      tx.execute(
        sql`INSERT INTO file_entries(organization_id,kind,parent_id,name,path,created_by) VALUES(${b.context.organizationId}::uuid,'folder',${b.root.id}::uuid,'bad',ARRAY['bad'],${a.context.userId}::uuid)`
      )
    ),
    sqlCode("42501")
  )
  await assert.rejects(
    run(a.context, (tx) =>
      tx.execute(
        sql`INSERT INTO file_entries(organization_id,kind,parent_id,name,path,created_by) VALUES(${a.context.organizationId}::uuid,'folder',${b.root.id}::uuid,'bad',ARRAY['bad'],${a.context.userId}::uuid)`
      )
    ),
    sqlCode("23503")
  )
  assert.equal(
    (
      await runtime.query(
        "SELECT NULLIF(current_setting('app.organization_id',true),'') AS scope"
      )
    ).rows[0].scope,
    null
  )
})

test("相同剩余quota的并发上传只预留一份，不重复结算，未删除目标不能释放", async () => {
  const a = await workspace()
  await owner.query(
    "UPDATE file_storage_usage SET quota_bytes=10 WHERE organization_id=$1",
    [a.context.organizationId]
  )
  const attempts = await Promise.allSettled(
    ["first", "second"].map((name) =>
      run(
        a.context,
        async (tx) => {
          const operation = await begin(tx, "upload", { name })
          await fileRepository.reserveUpload(tx, operation.id, {
            parentId: a.root.id,
            name,
            declaredBytes: 8,
          })
          return operation
        },
        "write"
      )
    )
  )
  assert.equal(
    attempts.filter((result) => result.status === "fulfilled").length,
    1
  )
  const winner = attempts.find((result) => result.status === "fulfilled")!
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.reservedBytes,
    8
  )
  const active = attempts.find((result) => result.status === "fulfilled")!
  if (active.status !== "fulfilled") throw new Error("missing winner")
  const waiting = await run(a.context, (tx) =>
    fileRepository.recordOperationError(
      tx,
      active.value.id,
      "STORAGE_UNAVAILABLE",
      new Date()
    )
  )
  assert.equal(waiting.phase, "preparing")
  assert.equal(waiting.errorCode, "STORAGE_UNAVAILABLE")
  assert.equal(waiting.committedAt, null)

  if (winner.status !== "fulfilled") throw new Error("missing winner")
  const objects = await run(a.context, (tx) =>
    fileRepository.addObjects(tx, winner.value.id, [
      {
        entryId: randomUUID(),
        directory: false,
        targetArea: "staging",
        targetPath: [winner.value.id],
      },
    ])
  )
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.failOperation(
        tx,
        winner.value.id,
        "STORAGE_UNAVAILABLE",
        new Date()
      )
    ),
    errorCode("FILE_OPERATION_NOT_READY")
  )
  await run(a.context, async (tx) => {
    await fileRepository.recordObjectDeleted(
      tx,
      winner.value.id,
      objects[0]!.id,
      "target",
      new Date()
    )
    await fileRepository.failOperation(
      tx,
      winner.value.id,
      "STORAGE_UNAVAILABLE",
      new Date()
    )
    await fileRepository.failOperation(
      tx,
      winner.value.id,
      "STORAGE_UNAVAILABLE",
      new Date()
    )
  })
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.reservedBytes,
    0
  )
})

test("操作身份先按actor/action/hash查重复，状态在重建Repository之后仍可查询", async () => {
  const a = await workspace(),
    id = randomUUID()
  const first = await run(a.context, (tx) =>
    begin(tx, "upload", { name: "a" }, id)
  )
  const same = await run(a.context, (tx) =>
    fileRepository.beginOperation(tx, {
      id,
      action: "upload",
      requestHash: sha(JSON.stringify({ name: "a" })),
      input: { name: "a" },
      expiresAt: first.expiresAt,
    })
  )
  assert.equal(same.reused, true)
  assert.equal(same.operation.createdAt.getTime(), first.createdAt.getTime())
  await assert.rejects(
    run(a.context, (tx) => begin(tx, "upload", { name: "b" }, id)),
    errorCode("IDEMPOTENCY_KEY_REUSED")
  )
  await assert.rejects(
    run({ ...a.context, userId: randomUUID() }, (tx) =>
      begin(tx, "upload", { name: "a" }, id)
    ),
    errorCode("IDEMPOTENCY_KEY_REUSED")
  )
  const fresh = createTenantRunner(runtime)
  assert.equal(
    (await fresh(a.context, (tx) => fileRepository.findOperation(tx, id)))!.id,
    id
  )
})

test("路径发布前只显示原层级，发布后等待精确源清理才能重用源名称", async () => {
  const a = await workspace()
  const tree = await folder(a.context, a.root.id, "旧目录")
  const empty = await folder(a.context, tree.id, "空目录")
  const file = await upload(a.context, tree.id, "a.txt", "original")
  const operation = await run(a.context, (tx) =>
    begin(tx, "rename", { entryId: tree.id, name: "新目录" })
  )
  const result = await run(a.context, (tx) =>
    fileRepository.preparePathOperation(tx, operation.id, {
      entryId: tree.id,
      expectedRevision: tree.revision,
      name: "新目录",
      now: new Date(),
    })
  )
  assert.equal(result.objects.length, 3)
  assert.deepEqual(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, file.id)))!.path,
    ["旧目录", "a.txt"]
  )
  await assert.rejects(
    upload(a.context, tree.id, "new.txt"),
    errorCode("FILE_OPERATION_IN_PROGRESS")
  )
  await run(a.context, async (tx) => {
    await prepared(tx, operation.id, result.objects)
    await fileRepository.commitPathOperation(tx, operation.id, new Date())
  })
  assert.deepEqual(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, empty.id)))!
      .path,
    ["新目录", "空目录"]
  )
  assert.equal(
    (await run(a.context, (tx) =>
      fileRepository.findOperation(tx, operation.id)
    ))!.committedAt instanceof Date,
    true
  )
  await assert.rejects(
    folder(a.context, a.root.id, "旧目录"),
    errorCode("FILE_OPERATION_IN_PROGRESS")
  )
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.finishOperation(tx, operation.id, new Date())
    ),
    errorCode("FILE_OPERATION_NOT_READY")
  )
  await run(a.context, async (tx) => {
    await fileRepository.failOperation(
      tx,
      operation.id,
      "STORAGE_UNAVAILABLE",
      new Date()
    )
    await complete(tx, operation.id, result.objects)
  })
  await folder(a.context, a.root.id, "旧目录")
  assert.equal(
    (
      await run(a.context, (tx) =>
        fileRepository.findVersion(tx, file.id, file.currentVersionId!)
      )
    ).version.sha256,
    sha("original")
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.transientBytes,
    0
  )
})

test("路径操作拒绝root、循环、过期revision，并协调子树未完成上传", async () => {
  const a = await workspace(),
    tree = await folder(a.context, a.root.id, "parent")
  const child = await folder(a.context, tree.id, "child")
  await assert.rejects(
    pathOperation(a.context, a.root, "rename", { name: "root" }),
    errorCode("FILE_ROOT_PROTECTED")
  )
  await assert.rejects(
    pathOperation(a.context, tree, "move", { parentId: child.id }),
    errorCode("FILE_FOLDER_CYCLE")
  )
  await assert.rejects(
    pathOperation(a.context, { ...tree, revision: 99 }, "rename", {
      name: "updated",
    }),
    errorCode("VERSION_CONFLICT")
  )
  await run(a.context, async (tx) => {
    const op = await begin(tx, "upload", { name: "pending" })
    await fileRepository.reserveUpload(tx, op.id, {
      parentId: child.id,
      name: "pending",
      declaredBytes: 1,
    })
  })
  await assert.rejects(
    pathOperation(a.context, tree, "rename", { name: "updated" }),
    errorCode("FILE_OPERATION_IN_PROGRESS")
  )
})

test("目录引用阻塞整棵子树，取消业务保存不建立引用，解除后才可移入回收站", async () => {
  const a = await workspace(),
    tree = await folder(a.context, a.root.id, "project")
  const file = await upload(a.context, tree.id, "bound.txt")
  const project = await run(a.context, (tx) =>
    projectRepository.create(tx, {
      name: "Project",
      description: "plain summary",
      contentLocale: "zh-CN",
    })
  )
  const business = {
    projectId: project.id,
    kind: "project_attachment",
    locale: null,
  } as const
  const reference = {
    fileId: file.id,
    versionId: file.currentVersionId!,
    referenceKey: randomUUID(),
    position: 0,
  }
  await assert.rejects(
    run(a.context, async (tx) => {
      await fileRepository.replaceReferences(tx, business, [reference])
      throw new Error("cancel draft")
    }),
    /cancel draft/
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.references(tx, file.id)))
      .length,
    0
  )
  await run(a.context, (tx) =>
    fileRepository.replaceReferences(tx, business, [reference])
  )
  await assert.rejects(
    pathOperation(a.context, tree, "trash"),
    errorCode("FILE_REFERENCED")
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, file.id)))!
      .state,
    "active"
  )
  await run(a.context, (tx) =>
    fileRepository.replaceReferences(tx, business, [])
  )
  const deleted = await pathOperation(a.context, tree, "trash")
  assert.equal(deleted.state, "trashed")
  assert.equal(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, file.id)))!
      .state,
    "trashed"
  )
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.findVersion(tx, file.id, file.currentVersionId!)
    ),
    errorCode("FILE_NOT_FOUND")
  )
})

test("回收站同路径的不同子树不会混合，恢复冲突要求明确位置，30天期限已记录", async () => {
  const a = await workspace()
  const oldTree = await folder(a.context, a.root.id, "same")
  const oldFile = await upload(a.context, oldTree.id, "a.txt", "old")
  const first = await pathOperation(a.context, oldTree, "trash")
  const newTree = await folder(a.context, a.root.id, "same")
  const newFile = await upload(a.context, newTree.id, "a.txt", "new")
  const second = await pathOperation(a.context, newTree, "trash")
  const restored = await pathOperation(a.context, first, "restore")
  assert.equal(restored.state, "active")
  assert.equal(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, newFile.id)))!
      .state,
    "trashed"
  )
  await assert.rejects(
    pathOperation(a.context, second, "restore"),
    errorCode("FILE_NAME_CONFLICT")
  )
  const explicit = await pathOperation(a.context, second, "restore", {
    name: "other",
  })
  assert.equal(explicit.name, "other")
  assert.equal(
    (
      await run(a.context, (tx) =>
        fileRepository.findVersion(tx, oldFile.id, oldFile.currentVersionId!)
      )
    ).version.sha256,
    sha("old")
  )
  assert.equal(
    first.expiresAt!.getTime() - first.deletedAt!.getTime(),
    30 * 86_400_000
  )
  const trashAgain = await pathOperation(a.context, restored, "trash")
  await assert.rejects(
    pathOperation(a.context, trashAgain, "restore", {
      now: trashAgain.expiresAt!,
    }),
    errorCode("FILE_RESTORE_EXPIRED")
  )
})

test("先独立删除子目录后再删除父目录，父目录恢复和清理不能并入另一回收批次", async () => {
  const a = await workspace()
  const parent = await folder(a.context, a.root.id, "parent")
  const child = await folder(a.context, parent.id, "child")
  const file = await upload(a.context, child.id, "retained.txt", "retained")
  const independent = await pathOperation(a.context, child, "trash")
  const trashedParent = await pathOperation(a.context, parent, "trash")
  const restoredParent = await pathOperation(
    a.context,
    trashedParent,
    "restore"
  )
  const retained = (await run(a.context, (tx) =>
    fileRepository.findEntry(tx, file.id)
  ))!
  assert.equal(retained.state, "trashed")
  assert.equal(retained.trashRootId, independent.id)
  assert.deepEqual(retained.path, ["parent", "child", "retained.txt"])
  const secondTrash = await pathOperation(a.context, restoredParent, "trash")
  await pathOperation(a.context, secondTrash, "purge")
  assert.equal(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, child.id)))!
      .state,
    "trashed"
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.usedBytes,
    Buffer.byteLength("retained")
  )
  await pathOperation(a.context, independent, "restore", {
    parentId: a.root.id,
  })
  const version = await run(a.context, (tx) =>
    fileRepository.findVersion(tx, file.id, file.currentVersionId!)
  )
  assert.equal(version.version.sha256, sha("retained"))
  assert.deepEqual(version.entry.path, ["child", "retained.txt"])
})

test("覆盖产生不可变新版本而原附件不改变；历史期限不受后续策略修改影响", async () => {
  const a = await workspace(),
    file = await upload(a.context, a.root.id, "version.txt", "old")
  const project = await run(a.context, (tx) =>
    projectRepository.create(tx, {
      name: "Project",
      description: null,
      contentLocale: "zh-CN",
    })
  )
  await run(a.context, (tx) =>
    fileRepository.replaceReferences(
      tx,
      { projectId: project.id, kind: "project_attachment", locale: null },
      [
        {
          fileId: file.id,
          versionId: file.currentVersionId!,
          referenceKey: "attachment",
          position: 0,
        },
      ]
    )
  )
  const next = await run(a.context, async (tx) => {
    const operation = await begin(tx, "overwrite", { fileId: file.id })
    await fileRepository.reserveUpload(tx, operation.id, {
      parentId: a.root.id,
      name: file.name,
      declaredBytes: 3,
      overwriteId: file.id,
      expectedRevision: file.revision,
    })
    const versionId = randomUUID()
    const objects = await fileRepository.addObjects(tx, operation.id, [
      {
        entryId: file.id,
        versionId: file.currentVersionId,
        directory: false,
        sourceArea: "files",
        sourcePath: file.path,
        targetArea: "history",
        targetPath: [file.id, file.currentVersionId!],
        expectedBytes: 3,
        expectedSha256: sha("old"),
      },
      {
        entryId: file.id,
        versionId,
        directory: false,
        targetArea: "files",
        targetPath: file.path,
        expectedBytes: 3,
        expectedSha256: sha("new"),
      },
    ])
    await prepared(tx, operation.id, objects)
    await fileRepository.recordObjectDeleted(
      tx,
      operation.id,
      objects[0]!.id,
      "source",
      new Date()
    )
    const updated = (await fileRepository.commitUpload(tx, operation.id, {
      fileId: file.id,
      versionId,
      objectId: objects[1]!.id,
      parentId: a.root.id,
      name: file.name,
      contentType: "text/plain",
      expectedRevision: file.revision,
    }))!
    await complete(tx, operation.id, objects)
    return updated
  })
  assert.notEqual(next.currentVersionId, file.currentVersionId)
  const versions = await run(a.context, (tx) =>
    fileRepository.versions(tx, file.id)
  )
  assert.equal(versions.length, 2)
  const old = versions.find((version) => version.id === file.currentVersionId)!
  assert.equal(old.sha256, sha("old"))
  assert.equal(old.storageArea, "history")
  assert.equal(
    old.expiresAt!.getTime() - old.retiredAt!.getTime(),
    90 * 86_400_000
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.references(tx, file.id)))[0]!
      .versionId,
    file.currentVersionId
  )
  await owner.query(
    "UPDATE file_storage_usage SET history_days=1 WHERE organization_id=$1",
    [a.context.organizationId]
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.versions(tx, file.id)))
      .find((version) => version.id === old.id)!
      .expiresAt!.getTime(),
    old.expiresAt!.getTime()
  )
  await assert.rejects(
    owner.query("UPDATE file_versions SET sha256=$1 WHERE id=$2", [
      sha("changed"),
      old.id,
    ]),
    sqlCode("23514")
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.usedBytes,
    6
  )
})

test("永久删除确认每个物理删除事实后结算，重复执行不重复扣容量", async () => {
  const a = await workspace(),
    file = await upload(a.context, a.root.id, "purge.txt", "charge")
  const deleted = await pathOperation(a.context, file, "trash")
  const op = await run(a.context, (tx) =>
    begin(tx, "purge", { entryId: file.id })
  )
  const result = await run(a.context, (tx) =>
    fileRepository.preparePathOperation(tx, op.id, {
      entryId: file.id,
      expectedRevision: deleted.revision,
      now: new Date(),
    })
  )
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.commitPathOperation(tx, op.id, new Date())
    ),
    errorCode("FILE_OPERATION_NOT_READY")
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.usedBytes,
    6
  )
  await run(a.context, async (tx) => {
    for (const object of result.objects)
      await fileRepository.recordObjectDeleted(
        tx,
        op.id,
        object.id,
        "source",
        new Date()
      )
    await fileRepository.commitPathOperation(tx, op.id, new Date())
    await fileRepository.commitPathOperation(tx, op.id, new Date())
    await complete(tx, op.id, result.objects)
  })
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.usedBytes,
    0
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, file.id)))!
      .state,
    "purged"
  )
})

test("富文本与引用使用同一事务和语言，失败保留旧内容、旧引用与纯文本概要", async () => {
  const a = await workspace(),
    file = await upload(a.context, a.root.id, "image.png")
  const project = await run(a.context, (tx) =>
    projectRepository.create(tx, {
      name: "Project",
      description: "plain summary",
      contentLocale: "zh-CN",
    })
  )
  const business = {
    projectId: project.id,
    kind: "project_rich_text",
    locale: "zh-CN",
  } as const
  const references = [
    {
      fileId: file.id,
      versionId: file.currentVersionId!,
      referenceKey: "image-node",
      position: 0,
    },
  ]
  await run(a.context, (tx) =>
    fileRepository.saveProjectContent(tx, business, {
      expectedRevision: null,
      document: { type: "doc", content: [] },
      references,
    })
  )
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.saveProjectContent(tx, business, {
        expectedRevision: 0,
        document: { changed: true },
        references: [],
      })
    ),
    errorCode("VERSION_CONFLICT")
  )
  await assert.rejects(
    run(a.context, async (tx) => {
      await fileRepository.saveProjectContent(tx, business, {
        expectedRevision: 1,
        document: { changed: true },
        references: [],
      })
      throw new Error("failed save")
    }),
    /failed save/
  )
  assert.equal(
    (await run(a.context, (tx) =>
      fileRepository.findProjectContent(tx, project.id, "zh-CN")
    ))!.revision,
    1
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.references(tx, file.id)))
      .length,
    1
  )
  assert.equal(
    (await run(a.context, (tx) =>
      projectRepository.findTranslation(tx, project.id, "zh-CN")
    ))!.description,
    "plain summary"
  )
  await run(a.context, (tx) =>
    fileRepository.saveProjectContent(
      tx,
      { ...business, locale: "ar" },
      {
        expectedRevision: null,
        document: { type: "doc", content: [] },
        references: [],
      }
    )
  )
  assert.equal(
    (await run(a.context, (tx) =>
      fileRepository.findProjectContent(tx, project.id, "ar")
    ))!.locale,
    "ar"
  )
})

test("审计写入故障回滚目录发布和operation提交事实", async () => {
  const a = await workspace()
  const op = await run(a.context, (tx) =>
    begin(tx, "create-folder", { name: "audit" })
  )
  const input = { id: randomUUID(), parentId: a.root.id, name: "audit" }
  const result = await run(a.context, (tx) =>
    fileRepository.prepareFolder(tx, op.id, input)
  )
  await run(a.context, (tx) => prepared(tx, op.id, result.objects))
  await owner.query(
    `CREATE FUNCTION fail_files_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id = '${a.context.organizationId}'::uuid AND NEW.event_code = 'folder.created' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_files_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_files_audit()`
  )
  try {
    await assert.rejects(
      run(a.context, (tx) => fileRepository.commitFolder(tx, op.id, input)),
      (error: unknown) =>
        sqlCode("P0001")(error) &&
        (error as { cause?: { message?: string } }).cause?.message ===
          "audit failure"
    )
    assert.equal(
      await run(a.context, (tx) => fileRepository.findEntry(tx, input.id)),
      undefined
    )
    assert.equal(
      (await run(a.context, (tx) => fileRepository.findOperation(tx, op.id)))!
        .committedAt,
      null
    )
  } finally {
    await owner.query(
      "DROP TRIGGER fail_files_audit ON audit_events; DROP FUNCTION fail_files_audit()"
    )
  }
})

test("并发同级名称预留只发布一个目录，引用绑定和删除不会同时成功", async () => {
  const a = await workspace()
  const names = await Promise.allSettled([
    folder(a.context, a.root.id, "one"),
    folder(a.context, a.root.id, "one"),
  ])
  assert.equal(
    names.filter((result) => result.status === "fulfilled").length,
    1
  )
  const file = await upload(a.context, a.root.id, "race.txt")
  const project = await run(a.context, (tx) =>
    projectRepository.create(tx, {
      name: "Race",
      description: null,
      contentLocale: "zh-CN",
    })
  )
  const race = await Promise.allSettled([
    run(a.context, (tx) =>
      fileRepository.replaceReferences(
        tx,
        { projectId: project.id, kind: "project_attachment", locale: null },
        [
          {
            fileId: file.id,
            versionId: file.currentVersionId!,
            referenceKey: "race",
            position: 0,
          },
        ]
      )
    ),
    pathOperation(a.context, file, "trash"),
  ])
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1)
  const entry = (await run(a.context, (tx) =>
    fileRepository.findEntry(tx, file.id)
  ))!
  const references = await run(a.context, (tx) =>
    fileRepository.references(tx, file.id)
  )
  assert.equal(
    entry.state === "active" ? references.length : 0,
    references.length
  )
  assert.equal(
    entry.state === "active" ? references.length : entry.state,
    entry.state === "active" ? 1 : "trashed"
  )
})

test("提交前原对象恢复必须校验并记录，失败清理不释放未恢复的原路径", async () => {
  const a = await workspace(),
    file = await upload(a.context, a.root.id, "original.txt", "keep")
  const operation = await run(a.context, (tx) =>
    begin(tx, "rename", { entryId: file.id, name: "changed.txt" })
  )
  const result = await run(a.context, (tx) =>
    fileRepository.preparePathOperation(tx, operation.id, {
      entryId: file.id,
      expectedRevision: file.revision,
      name: "changed.txt",
      now: new Date(),
    })
  )
  const object = result.objects[0]!
  await run(a.context, async (tx) => {
    await prepared(tx, operation.id, result.objects)
    await fileRepository.recordObjectDeleted(
      tx,
      operation.id,
      object.id,
      "source",
      new Date()
    )
    await fileRepository.recordObjectDeleted(
      tx,
      operation.id,
      object.id,
      "target",
      new Date()
    )
  })
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.failOperation(
        tx,
        operation.id,
        "STORAGE_UNAVAILABLE",
        new Date()
      )
    ),
    errorCode("FILE_OPERATION_NOT_READY")
  )
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.recordSourceRestored(
        tx,
        operation.id,
        object.id,
        { bytes: 4, sha256: sha("fake") },
        new Date()
      )
    ),
    errorCode("FILE_CONTENT_MISMATCH")
  )
  await run(a.context, async (tx) => {
    await fileRepository.recordSourceRestored(
      tx,
      operation.id,
      object.id,
      { bytes: 4, sha256: sha("keep") },
      new Date()
    )
    await fileRepository.failOperation(
      tx,
      operation.id,
      "STORAGE_UNAVAILABLE",
      new Date()
    )
  })
  assert.deepEqual(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, file.id)))!.path,
    ["original.txt"]
  )
  assert.equal(
    (
      await run(a.context, (tx) =>
        fileRepository.findVersion(tx, file.id, file.currentVersionId!)
      )
    ).version.sha256,
    sha("keep")
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.transientBytes,
    0
  )
})

test("过期认领可接管，未过期多实例只有一个claim且旧lease不能记录结果", async () => {
  const a = await workspace()
  const operation = await run(a.context, (tx) =>
    begin(tx, "create-folder", { name: "lease" })
  )
  const input = { id: randomUUID(), parentId: a.root.id, name: "lease" }
  const result = await run(a.context, (tx) =>
    fileRepository.prepareFolder(tx, operation.id, input)
  )
  const now = new Date(),
    leases = [randomUUID(), randomUUID()]
  const claims = await Promise.all(
    leases.map((lease) =>
      run(a.context, (tx) =>
        fileRepository.claimOperation(tx, operation.id, lease, now, 1000)
      )
    )
  )
  assert.equal(claims.filter(Boolean).length, 1)
  const prior = claims.find(Boolean)!
  const nextLease = randomUUID()
  const claimed = await run(a.context, (tx) =>
    fileRepository.claimOperation(
      tx,
      operation.id,
      nextLease,
      new Date(now.getTime() + 1001)
    )
  )
  assert.equal(claimed!.leaseId, nextLease)
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.recordPreparedObject(
        tx,
        operation.id,
        result.objects[0]!.id,
        { bytes: 0, sha256: null, transientBytes: 0 },
        prior.leaseId!
      )
    ),
    errorCode("FILE_OPERATION_LEASE_CONFLICT")
  )
})

test("数据库拒绝另一file的当前版本、folder超限与非当前父目录路径", async () => {
  const a = await workspace(),
    first = await upload(a.context, a.root.id, "first"),
    second = await upload(a.context, a.root.id, "second")
  await assert.rejects(
    run(a.context, async (tx) => {
      await tx
        .update(fileEntries)
        .set({ currentVersionId: second.currentVersionId })
        .where(eq(fileEntries.id, first.id))
      await tx.execute(
        sql`SET CONSTRAINTS file_entries_current_version_fk IMMEDIATE`
      )
    }),
    sqlCode("23503")
  )
  for (const name of ["a".repeat(247), "a\\b"])
    await assert.rejects(
      run(a.context, (tx) =>
        tx.insert(fileEntries).values({
          organizationId: a.context.organizationId,
          parentId: a.root.id,
          kind: "folder",
          name,
          path: [name],
          createdBy: a.context.userId,
        })
      ),
      sqlCode("23514")
    )
  await assert.rejects(
    run(a.context, (tx) =>
      tx.insert(fileEntries).values({
        organizationId: a.context.organizationId,
        parentId: first.id,
        kind: "folder",
        name: "child",
        path: ["first", "child"],
        createdBy: a.context.userId,
      })
    ),
    sqlCode("23514")
  )
})

async function platformActor(
  role: "platform_admin" | "platform_auditor" = "platform_admin"
) {
  const actorId = randomUUID(),
    sessionId = randomUUID()
  await owner.query(
    `INSERT INTO public."user" (id,name,email,email_verified,two_factor_enabled)
    VALUES ($1,'platform',$2,true,true)`,
    [actorId, `${actorId}@example.test`]
  )
  await owner.query(
    `INSERT INTO public.session (id,user_id,token,expires_at,updated_at)
    VALUES ($1,$2,$3,now()+interval '1 hour',now())`,
    [sessionId, actorId, randomUUID()]
  )
  await owner.query(
    `INSERT INTO public.platform_assignment
    (user_id,role,status,version,granted_at,granted_by,grant_reason)
    VALUES ($1,$2,'active',1,now(),'test','storage policy verification')`,
    [actorId, role]
  )
  await owner.query(
    `INSERT INTO public.platform_session_assurance (session_id,user_id,verified_at,method)
    VALUES ($1,$2,now(),'totp')`,
    [sessionId, actorId]
  )
  return { actorId, sessionId }
}
async function policy(
  actor: { actorId: string; sessionId: string },
  organizationId: string
) {
  return (
    await runtime.query(
      `SELECT public.get_platform_storage_policy($1,$2,$3,$4) AS result`,
      [actor.actorId, actor.sessionId, organizationId, randomUUID()]
    )
  ).rows[0]!.result
}
async function changePolicy(
  actor: { actorId: string; sessionId: string },
  organizationId: string,
  options: {
    quotaBytes?: number
    trashDays?: number
    historyDays?: number
    version?: number
    key?: string
    reason?: string
  } = {}
) {
  return (
    await runtime.query(
      `SELECT public.update_platform_storage_policy($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result`,
      [
        actor.actorId,
        actor.sessionId,
        organizationId,
        options.quotaBytes ?? 10 * 1024 ** 3,
        options.trashDays ?? 30,
        options.historyDays ?? 90,
        options.reason ?? "Approved storage policy change",
        options.version ?? 1,
        options.key ?? randomUUID(),
        randomUUID(),
      ]
    )
  ).rows[0]!.result
}
const databaseMessage = (message: string) => (error: unknown) => {
  const value = error as { code?: string; message?: string }
  return value.code === "P0001" && value.message === message
}

test("平台存储策略只返回容量摘要，任职不产生文件表读取或策略直写资格", async () => {
  const a = await workspace(),
    actor = await platformActor("platform_auditor")
  await upload(a.context, a.root.id, "private-name.txt", "private")
  const result = await policy(actor, a.context.organizationId)
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "organizationId",
      "quotaBytes",
      "usedBytes",
      "reservedBytes",
      "transientBytes",
      "trashDays",
      "historyDays",
      "version",
      "overQuota",
    ].sort()
  )
  assert.equal(result.usedBytes, 7)
  assert.equal(result.version, 1)
  assert.equal(JSON.stringify(result).includes("private-name"), false)
  assert.equal(
    (
      await owner.query(
        `SELECT has_table_privilege('platform_executor','public.file_entries','SELECT') AS allowed`
      )
    ).rows[0]!.allowed,
    false
  )
  assert.equal(
    (
      await runtime.query(
        "SELECT count(*)::integer AS total FROM public.file_storage_usage"
      )
    ).rows[0]!.total,
    0
  )
  await assert.rejects(
    runtime.query("UPDATE public.file_storage_usage SET quota_bytes=1"),
    sqlCode("42501")
  )
  const functions =
    await owner.query(`SELECT proname, rolname AS owner, prosecdef,
    has_function_privilege('platform_runtime', p.oid, 'EXECUTE') AS legacy,
    has_function_privilege('platform_deployer', p.oid, 'EXECUTE') AS deployer
    FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    WHERE proname IN ('get_platform_storage_policy','update_platform_storage_policy','record_platform_storage_policy_failure')`)
  assert.equal(functions.rowCount, 3)
  for (const fn of functions.rows) {
    assert.equal(fn.owner, "platform_executor")
    assert.equal(fn.prosecdef, true)
    assert.equal(fn.legacy, false)
    assert.equal(fn.deployer, false)
  }
  const audit = (
    await owner.query(
      `SELECT tenant_visible,scope,fields FROM audit_events
    WHERE organization_id=$1 AND event_code='platform.storage_policy_viewed'`,
      [a.context.organizationId]
    )
  ).rows
  assert.equal(audit.length, 1)
  assert.equal(audit[0]!.tenant_visible, false)
  assert.deepEqual(audit[0]!.fields, {})
})

test("平台策略CAS与幂等收据原子提交，不重复审计，相同输入不增加版本", async () => {
  const a = await workspace(),
    actor = await platformActor(),
    key = randomUUID()
  const first = await changePolicy(actor, a.context.organizationId, {
    quotaBytes: 123,
    trashDays: 7,
    historyDays: 14,
    key,
  })
  assert.equal(first.version, 2)
  assert.equal(first.changed, true)
  assert.deepEqual(
    await changePolicy(actor, a.context.organizationId, {
      quotaBytes: 123,
      trashDays: 7,
      historyDays: 14,
      key,
    }),
    first
  )
  await assert.rejects(
    changePolicy(actor, a.context.organizationId, { quotaBytes: 124, key }),
    databaseMessage("IDEMPOTENCY_KEY_REUSED")
  )
  await assert.rejects(
    changePolicy(actor, a.context.organizationId),
    databaseMessage("VERSION_CONFLICT")
  )
  const unchanged = await changePolicy(actor, a.context.organizationId, {
    quotaBytes: 123,
    trashDays: 7,
    historyDays: 14,
    version: 2,
  })
  assert.equal(unchanged.version, 2)
  assert.equal(unchanged.result, "no_change")
  const events = (
    await owner.query(
      `SELECT fields,result,operation_id FROM audit_events
    WHERE organization_id=$1 AND event_code='platform.storage_policy_updated' ORDER BY occurred_at,id`,
      [a.context.organizationId]
    )
  ).rows
  assert.equal(events.length, 2)
  assert.deepEqual(events[0]!.fields.previous, {
    quotaBytes: 10 * 1024 ** 3,
    trashDays: 30,
    historyDays: 90,
  })
  assert.equal(events[0]!.operation_id, first.operationId)
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::integer AS total FROM operation_receipts WHERE actor_id=$1",
        [actor.actorId]
      )
    ).rows[0]!.total,
    2
  )
})

test("平台审计员只读，管理员写入需要近期MFA与当前有效Session/任职", async () => {
  const a = await workspace(),
    auditor = await platformActor("platform_auditor"),
    admin = await platformActor()
  await policy(auditor, a.context.organizationId)
  await assert.rejects(
    changePolicy(auditor, a.context.organizationId),
    databaseMessage("FORBIDDEN")
  )
  await owner.query(
    `UPDATE platform_session_assurance SET verified_at=now()-interval '16 minutes' WHERE session_id=$1`,
    [admin.sessionId]
  )
  await policy(admin, a.context.organizationId)
  await assert.rejects(
    changePolicy(admin, a.context.organizationId),
    databaseMessage("PLATFORM_MFA_REQUIRED")
  )
  await owner.query(
    "DELETE FROM platform_session_assurance WHERE session_id=$1",
    [admin.sessionId]
  )
  await assert.rejects(
    policy(admin, a.context.organizationId),
    databaseMessage("PLATFORM_MFA_REQUIRED")
  )
  await owner.query(
    `UPDATE session SET expires_at=now()-interval '1 second' WHERE id=$1`,
    [auditor.sessionId]
  )
  await assert.rejects(
    policy(auditor, a.context.organizationId),
    databaseMessage("FORBIDDEN")
  )
  await assert.rejects(
    policy(
      { actorId: randomUUID(), sessionId: randomUUID() },
      a.context.organizationId
    ),
    databaseMessage("FORBIDDEN")
  )
})

test("降低配额保留原对象和已记录期限，新删除才采用新策略", async () => {
  const a = await workspace(),
    actor = await platformActor()
  const file = await upload(a.context, a.root.id, "retained.txt", "abc")
  const oldTrash = await pathOperation(a.context, file, "trash")
  const result = await changePolicy(actor, a.context.organizationId, {
    quotaBytes: 1,
    trashDays: 1,
    historyDays: 2,
  })
  assert.equal(result.overQuota, true)
  assert.equal(result.usedBytes, 3)
  const retained = (await run(a.context, (tx) =>
    fileRepository.findEntry(tx, file.id)
  ))!
  assert.equal(retained.expiresAt!.getTime(), oldTrash.expiresAt!.getTime())
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::integer AS total FROM file_versions WHERE organization_id=$1 AND purged_at IS NULL",
        [a.context.organizationId]
      )
    ).rows[0]!.total,
    1
  )
  const restored = await pathOperation(a.context, retained, "restore")
  await assert.rejects(
    upload(a.context, a.root.id, "over.txt", "x"),
    errorCode("FILE_QUOTA_EXCEEDED")
  )
  const freshTrash = await pathOperation(a.context, restored, "trash")
  assert.equal(
    freshTrash.expiresAt!.getTime() - freshTrash.deletedAt!.getTime(),
    86_400_000
  )
})

test("平台策略并发CAS只有一个成功，另一请求不能覆盖已提交配置", async () => {
  const a = await workspace(),
    actor = await platformActor()
  const results = await Promise.allSettled([
    changePolicy(actor, a.context.organizationId, { quotaBytes: 10 }),
    changePolicy(actor, a.context.organizationId, { quotaBytes: 20 }),
  ])
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1)
  const rejected = results.find(
    (x) => x.status === "rejected"
  ) as PromiseRejectedResult
  assert.equal(databaseMessage("VERSION_CONFLICT")(rejected.reason), true)
  assert.equal((await policy(actor, a.context.organizationId)).version, 2)
})

test("等待容量行锁后重新查平台授权，旧收据不能绕过任职撤销", async () => {
  const a = await workspace(),
    actor = await platformActor()
  const key = randomUUID()
  await changePolicy(actor, a.context.organizationId, { quotaBytes: 10, key })
  const blocker = await owner.connect(),
    updater = await runtime.connect()
  const applicationName = `storage-policy-${randomUUID()}`
  try {
    await blocker.query("BEGIN")
    await blocker.query(
      "SELECT * FROM file_storage_usage WHERE organization_id=$1 FOR UPDATE",
      [a.context.organizationId]
    )
    await updater.query("SELECT set_config('application_name',$1,false)", [
      applicationName,
    ])
    const pending = updater.query(
      `SELECT public.update_platform_storage_policy($1,$2,$3,10,30,90,'Approved storage policy change',1,$4,$5)`,
      [
        actor.actorId,
        actor.sessionId,
        a.context.organizationId,
        key,
        randomUUID(),
      ]
    )
    const rejection = assert.rejects(pending, databaseMessage("FORBIDDEN"))
    let waiting = false
    for (let i = 0; i < 200; i++) {
      waiting = (
        await owner.query(
          `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') AS waiting`,
          [applicationName]
        )
      ).rows[0]!.waiting
      if (waiting) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(waiting, true)
    await owner.query(
      `UPDATE platform_assignment SET status='revoked',revoked_at=now(),revoked_by='test',revoke_reason='Authorization revoked while waiting' WHERE user_id=$1`,
      [actor.actorId]
    )
    await blocker.query("COMMIT")
    await rejection
    assert.equal(
      (
        await owner.query(
          "SELECT quota_bytes FROM file_storage_usage WHERE organization_id=$1",
          [a.context.organizationId]
        )
      ).rows[0]!.quota_bytes,
      "10"
    )
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    updater.release()
  }
})

test("平台策略审计故障不返回摘要，不提交配置或幂等收据", async () => {
  const a = await workspace(),
    actor = await platformActor(),
    key = randomUUID()
  await owner.query(`CREATE FUNCTION public.fail_storage_policy_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.organization_id='${a.context.organizationId}'::uuid AND NEW.event_code IN ('platform.storage_policy_viewed','platform.storage_policy_updated')
    THEN RAISE EXCEPTION 'storage audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER storage_policy_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION public.fail_storage_policy_audit()`)
  try {
    await assert.rejects(
      policy(actor, a.context.organizationId),
      databaseMessage("AUDIT_UNAVAILABLE")
    )
    await assert.rejects(
      changePolicy(actor, a.context.organizationId, { quotaBytes: 1, key }),
      databaseMessage("AUDIT_UNAVAILABLE")
    )
    const usage = (
      await owner.query(
        "SELECT quota_bytes,policy_revision FROM file_storage_usage WHERE organization_id=$1",
        [a.context.organizationId]
      )
    ).rows[0]!
    assert.equal(usage.quota_bytes, String(10 * 1024 ** 3))
    assert.equal(usage.policy_revision, 1)
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::integer AS total FROM operation_receipts WHERE actor_id=$1",
          [actor.actorId]
        )
      ).rows[0]!.total,
      0
    )
  } finally {
    await owner.query(
      "DROP TRIGGER storage_policy_audit_failure ON audit_events; DROP FUNCTION public.fail_storage_policy_audit()"
    )
  }
})

test("平台失败审计只保存稳定码并独立提交，无上下文和组织停用不开放文件索引", async () => {
  const a = await workspace(),
    actor = await platformActor()
  await owner.query(
    `UPDATE organization_status SET status='SUSPENDED',status_version=status_version+1 WHERE organization_id=$1`,
    [a.context.organizationId]
  )
  await policy(actor, a.context.organizationId)
  await runtime.query(
    `SELECT public.record_platform_storage_policy_failure($1,$2,'update','FORBIDDEN',$3)`,
    [actor.actorId, a.context.organizationId, randomUUID()]
  )
  await assert.rejects(
    runtime.query(
      `SELECT public.record_platform_storage_policy_failure($1,$2,'update','raw secret error',$3)`,
      [actor.actorId, a.context.organizationId, randomUUID()]
    ),
    databaseMessage("VALIDATION_ERROR")
  )
  const event = (
    await owner.query(
      `SELECT result,reason,tenant_visible FROM audit_events WHERE organization_id=$1 AND event_code='platform.storage_policy_updated'`,
      [a.context.organizationId]
    )
  ).rows[0]!
  assert.deepEqual(event, {
    result: "denied",
    reason: "FORBIDDEN",
    tenant_visible: false,
  })
  assert.equal(
    (await runtime.query("SELECT count(*)::integer AS total FROM file_entries"))
      .rows[0]!.total,
    0
  )
  await runtime.query(
    `SELECT set_config('app.platform_storage_organization_id',$1,false)`,
    [a.context.organizationId]
  )
  assert.equal(
    (
      await runtime.query(
        "SELECT count(*)::integer AS total FROM file_storage_usage"
      )
    ).rows[0]!.total,
    0
  )
})

async function identityActor() {
  const actorId = randomUUID(),
    sessionId = randomUUID()
  await owner.query(
    `INSERT INTO public."user" (id,name,email,email_verified) VALUES ($1,'media',$2,true)`,
    [actorId, `${actorId}@example.test`]
  )
  await owner.query(
    `INSERT INTO public.session (id,user_id,token,expires_at,updated_at)
    VALUES ($1,$2,$3,now()+interval '1 hour',now())`,
    [sessionId, actorId, randomUUID()]
  )
  return { actorId, sessionId }
}
async function personalUpload(
  actor: { actorId: string; sessionId: string },
  body = "decoded image bytes"
) {
  const operationId = randomUUID(),
    leaseId = randomUUID()
  const begun = (
    await runtime.query(
      "SELECT public.begin_personal_media_upload($1,$2,$3,$4,$5,$6) AS result",
      [
        actor.actorId,
        actor.sessionId,
        operationId,
        sha(JSON.stringify({ bytes: Buffer.byteLength(body) })),
        Buffer.byteLength(body),
        randomUUID(),
      ]
    )
  ).rows[0]!.result
  await runtime.query(
    "SELECT public.claim_personal_media_upload($1,$2,$3,$4)",
    [actor.actorId, actor.sessionId, operationId, leaseId]
  )
  const media = (
    await runtime.query(
      "SELECT public.publish_personal_media_upload($1,$2,$3,$4,$5,$6,$7,$8) AS result",
      [
        actor.actorId,
        actor.sessionId,
        operationId,
        leaseId,
        Buffer.byteLength(body),
        sha(body),
        "image/png",
        randomUUID(),
      ]
    )
  ).rows[0]!.result
  return { media, operationId, leaseId, begun, body }
}
async function avatar(
  actor: { actorId: string; sessionId: string },
  mediaId: string | null,
  expectedImage: string | null,
  key = randomUUID()
) {
  return (
    await runtime.query(
      "SELECT public.set_personal_avatar($1,$2,$3,$4,$5,$6) AS result",
      [
        actor.actorId,
        actor.sessionId,
        mediaId,
        expectedImage,
        key,
        randomUUID(),
      ]
    )
  ).rows[0]!.result
}
async function personalRead(
  actor: { actorId: string; sessionId: string },
  mediaId: string,
  organizationId: string | null = null
) {
  return (
    await runtime.query(
      "SELECT public.get_personal_media_content($1,$2,$3,$4) AS result",
      [actor.actorId, actor.sessionId, mediaId, organizationId]
    )
  ).rows[0]!.result
}

test("个人媒体与组织隔离，runtime无表直读写，上传完成不改变User.image", async () => {
  const actor = await identityActor(),
    b = await identityActor(),
    a = await workspace()
  const uploaded = await personalUpload(actor)
  assert.equal(
    (
      await owner.query('SELECT image FROM public."user" WHERE id=$1', [
        actor.actorId,
      ])
    ).rows[0]!.image,
    null
  )
  assert.equal(uploaded.media.user_id, actor.actorId)
  assert.deepEqual(uploaded.media.storage_path, [uploaded.media.id])
  assert.equal(uploaded.media.bytes, Buffer.byteLength(uploaded.body))
  assert.equal(Object.hasOwn(uploaded.media, "organization_id"), false)
  assert.equal(
    (await personalRead(actor, uploaded.media.id)).sha256,
    sha(uploaded.body)
  )
  await assert.rejects(
    personalRead(b, uploaded.media.id),
    databaseMessage("PERSONAL_MEDIA_NOT_FOUND")
  )
  await assert.rejects(
    avatar(b, uploaded.media.id, null),
    databaseMessage("PERSONAL_MEDIA_NOT_FOUND")
  )
  const organizationFile = await upload(a.context, a.root.id, "private.png")
  await assert.rejects(
    avatar(actor, organizationFile.id, null),
    databaseMessage("PERSONAL_MEDIA_NOT_FOUND")
  )
  for (const table of ["personal_media", "personal_media_operations"]) {
    await assert.rejects(
      runtime.query(`SELECT * FROM ${table}`),
      sqlCode("42501")
    )
    const flags = (
      await owner.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=$1",
        [table]
      )
    ).rows[0]!
    assert.equal(flags.relrowsecurity, true)
    assert.equal(flags.relforcerowsecurity, true)
  }
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.usedBytes,
    3
  )
})

test("头像CAS保存、更换与移除只修改User.image，旧个人媒体记录24h期限", async () => {
  const actor = await identityActor(),
    first = await personalUpload(actor, "first"),
    second = await personalUpload(actor, "second")
  const key = randomUUID()
  const saved = await avatar(actor, first.media.id, null, key)
  assert.equal(saved.image, `/api/v1/personal-media/${first.media.id}/content`)
  assert.deepEqual(await avatar(actor, first.media.id, null, key), saved)
  await assert.rejects(
    avatar(actor, second.media.id, null),
    databaseMessage("VERSION_CONFLICT")
  )
  assert.equal((await personalRead(actor, first.media.id)).expires_at, null)
  const replaced = await avatar(actor, second.media.id, saved.image)
  const old = await personalRead(actor, first.media.id)
  assert.equal(Date.parse(old.expires_at) > Date.now() + 23 * 3600_000, true)
  assert.equal((await personalRead(actor, second.media.id)).expires_at, null)
  assert.deepEqual(await avatar(actor, first.media.id, null, key), saved)
  assert.equal(
    (
      await owner.query('SELECT image FROM public."user" WHERE id=$1', [
        actor.actorId,
      ])
    ).rows[0]!.image,
    replaced.image
  )
  await assert.rejects(
    avatar(actor, second.media.id, null, key),
    databaseMessage("IDEMPOTENCY_KEY_REUSED")
  )
  const removed = await avatar(actor, null, replaced.image)
  assert.equal(removed.image, null)
  assert.equal(
    (
      await owner.query('SELECT image FROM public."user" WHERE id=$1', [
        actor.actorId,
      ])
    ).rows[0]!.image,
    null
  )
  assert.equal(
    Date.parse((await personalRead(actor, second.media.id)).expires_at) >
      Date.now() + 23 * 3600_000,
    true
  )
  assert.equal(
    (
      await owner.query(
        `SELECT count(*)::integer AS total FROM audit_events WHERE actor_id=$1 AND event_code='user.avatar_updated'`,
        [actor.actorId]
      )
    ).rows[0]!.total,
    3
  )
})

test("并发头像保存同一旧引用只有一个成功，不产生两个当前头像事实", async () => {
  const actor = await identityActor(),
    first = await personalUpload(actor, "first"),
    second = await personalUpload(actor, "second")
  const results = await Promise.allSettled([
    avatar(actor, first.media.id, null),
    avatar(actor, second.media.id, null),
  ])
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1)
  assert.equal(
    databaseMessage("VERSION_CONFLICT")(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason
    ),
    true
  )
  const current = (
    await owner.query('SELECT image FROM public."user" WHERE id=$1', [
      actor.actorId,
    ])
  ).rows[0]!.image
  assert.equal(
    [first.media.id, second.media.id].some(
      (id) => current === `/api/v1/personal-media/${id}/content`
    ),
    true
  )
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::integer AS total FROM personal_media WHERE user_id=$1 AND expires_at IS NULL",
        [actor.actorId]
      )
    ).rows[0]!.total,
    1
  )
})

test("他人只在共享ACTIVE组织及member:read下读取当前头像，平台任职不产生资格", async () => {
  const subject = await identityActor(),
    viewer = await identityActor(),
    outsider = await platformActor(),
    a = await workspace()
  const uploaded = await personalUpload(subject)
  await owner.query(
    `INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES ($1,$2,$3,'owner',now()),($4,$2,$5,'member',now())`,
    [
      randomUUID(),
      a.context.organizationId,
      subject.actorId,
      randomUUID(),
      viewer.actorId,
    ]
  )
  await assert.rejects(
    personalRead(viewer, uploaded.media.id, a.context.organizationId),
    databaseMessage("PERSONAL_MEDIA_NOT_FOUND")
  )
  await avatar(subject, uploaded.media.id, null)
  assert.equal(
    (await personalRead(viewer, uploaded.media.id, a.context.organizationId))
      .id,
    uploaded.media.id
  )
  await assert.rejects(
    personalRead(outsider, uploaded.media.id, a.context.organizationId),
    databaseMessage("PERSONAL_MEDIA_NOT_FOUND")
  )
  await owner.query(
    `UPDATE organization_status SET status='SUSPENDED' WHERE organization_id=$1`,
    [a.context.organizationId]
  )
  await assert.rejects(
    personalRead(viewer, uploaded.media.id, a.context.organizationId),
    databaseMessage("PERSONAL_MEDIA_NOT_FOUND")
  )
  assert.equal(
    (await personalRead(subject, uploaded.media.id)).id,
    uploaded.media.id
  )
  await owner.query(
    `UPDATE organization_status SET status='ACTIVE' WHERE organization_id=$1`,
    [a.context.organizationId]
  )
  await owner.query(
    `INSERT INTO organization_role(id,organization_id,role,permission,created_at,updated_at) VALUES($1,$2,'limited',$3,now(),now())`,
    [
      randomUUID(),
      a.context.organizationId,
      JSON.stringify({ project: ["read"] }),
    ]
  )
  await owner.query(
    `UPDATE member SET role='limited' WHERE organization_id=$1 AND user_id=$2`,
    [a.context.organizationId, viewer.actorId]
  )
  await assert.rejects(
    personalRead(viewer, uploaded.media.id, a.context.organizationId),
    databaseMessage("PERSONAL_MEDIA_NOT_FOUND")
  )
  await owner.query(
    `UPDATE organization_role SET permission=$1 WHERE organization_id=$2 AND role='limited'`,
    [JSON.stringify({ member: ["read"] }), a.context.organizationId]
  )
  assert.equal(
    (await personalRead(viewer, uploaded.media.id, a.context.organizationId))
      .id,
    uploaded.media.id
  )
  await owner.query(
    "DELETE FROM member WHERE organization_id=$1 AND user_id=$2",
    [a.context.organizationId, viewer.actorId]
  )
  await assert.rejects(
    personalRead(viewer, uploaded.media.id, a.context.organizationId),
    databaseMessage("PERSONAL_MEDIA_NOT_FOUND")
  )
})

test("任意image URL更新被数据库拒绝，昵称/语言更新不误伤已有受控头像", async () => {
  const actor = await identityActor(),
    uploaded = await personalUpload(actor)
  const saved = await avatar(actor, uploaded.media.id, null)
  await assert.rejects(
    runtime.query('UPDATE public."user" SET image=$1 WHERE id=$2', [
      "https://example.test/unverified.png",
      actor.actorId,
    ]),
    sqlCode("42501")
  )
  await assert.rejects(
    runtime.query('UPDATE public."user" SET image=NULL WHERE id=$1', [
      actor.actorId,
    ]),
    sqlCode("42501")
  )
  await runtime.query(
    `UPDATE public."user" SET name='renamed',preferred_locale='ar',image=image WHERE id=$1`,
    [actor.actorId]
  )
  assert.equal(
    (
      await owner.query(
        'SELECT image,name,preferred_locale FROM public."user" WHERE id=$1',
        [actor.actorId]
      )
    ).rows[0]!.image,
    saved.image
  )
  await assert.rejects(
    owner.query("UPDATE personal_media SET bytes=999 WHERE id=$1", [
      uploaded.media.id,
    ]),
    sqlCode("23514")
  )
})

test("个人上传身份/内容/5MiB边界和lease一致，重复完成不产生第二对象", async () => {
  const actor = await identityActor(),
    uploaded = await personalUpload(actor, "same")
  await assert.rejects(
    runtime.query(
      "SELECT public.begin_personal_media_upload($1,$2,$3,$4,$5,$6)",
      [
        actor.actorId,
        actor.sessionId,
        randomUUID(),
        sha("oversized"),
        5 * 1024 ** 2 + 1,
        randomUUID(),
      ]
    ),
    databaseMessage("VALIDATION_ERROR")
  )
  const same = (
    await runtime.query(
      "SELECT public.publish_personal_media_upload($1,$2,$3,$4,4,$5,$6,$7) AS result",
      [
        actor.actorId,
        actor.sessionId,
        uploaded.operationId,
        uploaded.leaseId,
        sha("same"),
        "image/png",
        randomUUID(),
      ]
    )
  ).rows[0]!.result
  assert.equal(same.id, uploaded.media.id)
  await assert.rejects(
    runtime.query(
      "SELECT public.publish_personal_media_upload($1,$2,$3,$4,4,$5,$6,$7)",
      [
        actor.actorId,
        actor.sessionId,
        uploaded.operationId,
        uploaded.leaseId,
        sha("diff"),
        "image/png",
        randomUUID(),
      ]
    ),
    databaseMessage("PERSONAL_MEDIA_CONTENT_MISMATCH")
  )
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::integer AS total FROM personal_media WHERE user_id=$1",
        [actor.actorId]
      )
    ).rows[0]!.total,
    1
  )
  const operationId = randomUUID(),
    leaseId = randomUUID()
  await runtime.query(
    "SELECT public.begin_personal_media_upload($1,$2,$3,$4,4,$5)",
    [actor.actorId, actor.sessionId, operationId, sha("request"), randomUUID()]
  )
  const claims = await Promise.all([
    runtime.query(
      "SELECT public.claim_personal_media_upload($1,$2,$3,$4) AS result",
      [actor.actorId, actor.sessionId, operationId, leaseId]
    ),
    runtime.query(
      "SELECT public.claim_personal_media_upload($1,$2,$3,$4) AS result",
      [actor.actorId, actor.sessionId, operationId, randomUUID()]
    ),
  ])
  assert.equal(claims.filter((c) => c.rows[0]!.result !== null).length, 1)
  const chosen = claims.find((c) => c.rows[0]!.result !== null)!.rows[0]!.result
    .lease_id
  await assert.rejects(
    runtime.query(
      "SELECT public.publish_personal_media_upload($1,$2,$3,$4,4,$5,$6,$7)",
      [
        actor.actorId,
        actor.sessionId,
        operationId,
        randomUUID(),
        sha("same"),
        "image/png",
        randomUUID(),
      ]
    ),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  await runtime.query(
    "SELECT public.fail_personal_media_upload($1,$2,$3,$4,$5)",
    [actor.actorId, actor.sessionId, operationId, chosen, "STORAGE_UNAVAILABLE"]
  )
  const failed = (
    await runtime.query(
      "SELECT public.get_personal_media_operation($1,$2,$3) AS result",
      [actor.actorId, actor.sessionId, operationId]
    )
  ).rows[0]!.result
  assert.equal(failed.phase, "failed")
  assert.equal(failed.committed_at, null)
  assert.equal(typeof failed.cleaned_at, "string")
})

test("个人发布最终Session失效时不创建媒体或修改头像，保留待清理操作事实", async () => {
  const actor = await identityActor(),
    operationId = randomUUID(),
    leaseId = randomUUID()
  await runtime.query(
    "SELECT public.begin_personal_media_upload($1,$2,$3,$4,4,$5)",
    [actor.actorId, actor.sessionId, operationId, sha("request"), randomUUID()]
  )
  await runtime.query(
    "SELECT public.claim_personal_media_upload($1,$2,$3,$4)",
    [actor.actorId, actor.sessionId, operationId, leaseId]
  )
  await owner.query("DELETE FROM session WHERE id=$1", [actor.sessionId])
  await assert.rejects(
    runtime.query(
      "SELECT public.publish_personal_media_upload($1,$2,$3,$4,4,$5,$6,$7)",
      [
        actor.actorId,
        actor.sessionId,
        operationId,
        leaseId,
        sha("same"),
        "image/png",
        randomUUID(),
      ]
    ),
    databaseMessage("UNAUTHENTICATED")
  )
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::integer AS total FROM personal_media WHERE user_id=$1",
        [actor.actorId]
      )
    ).rows[0]!.total,
    0
  )
  const operation = (
    await owner.query(
      "SELECT phase,committed_at FROM personal_media_operations WHERE user_id=$1 AND id=$2",
      [actor.actorId, operationId]
    )
  ).rows[0]!
  assert.deepEqual(operation, { phase: "preparing", committed_at: null })
})

test("个人媒体和头像成功审计故障回滚发布/引用/24h期限及收据", async () => {
  const actor = await identityActor(),
    uploaded = await personalUpload(actor)
  await owner.query(`CREATE FUNCTION public.fail_personal_media_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.actor_id='${actor.actorId}'::uuid AND NEW.event_code IN ('personal_media.uploaded','user.avatar_updated')
    THEN RAISE EXCEPTION 'personal media audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER personal_media_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION public.fail_personal_media_audit()`)
  const operationId = randomUUID(),
    leaseId = randomUUID()
  await runtime.query(
    "SELECT public.begin_personal_media_upload($1,$2,$3,$4,4,$5)",
    [actor.actorId, actor.sessionId, operationId, sha("request"), randomUUID()]
  )
  await runtime.query(
    "SELECT public.claim_personal_media_upload($1,$2,$3,$4)",
    [actor.actorId, actor.sessionId, operationId, leaseId]
  )
  try {
    await assert.rejects(
      avatar(actor, uploaded.media.id, null),
      databaseMessage("AUDIT_UNAVAILABLE")
    )
    assert.equal(
      (
        await owner.query('SELECT image FROM public."user" WHERE id=$1', [
          actor.actorId,
        ])
      ).rows[0]!.image,
      null
    )
    assert.equal(
      (await personalRead(actor, uploaded.media.id)).expires_at,
      uploaded.media.expires_at
    )
    await assert.rejects(
      runtime.query(
        "SELECT public.publish_personal_media_upload($1,$2,$3,$4,4,$5,$6,$7)",
        [
          actor.actorId,
          actor.sessionId,
          operationId,
          leaseId,
          sha("same"),
          "image/png",
          randomUUID(),
        ]
      ),
      databaseMessage("AUDIT_UNAVAILABLE")
    )
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::integer AS total FROM personal_media WHERE user_id=$1",
          [actor.actorId]
        )
      ).rows[0]!.total,
      1
    )
    assert.equal(
      (
        await owner.query(
          "SELECT committed_at FROM personal_media_operations WHERE user_id=$1 AND id=$2",
          [actor.actorId, operationId]
        )
      ).rows[0]!.committed_at,
      null
    )
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::integer AS total FROM operation_receipts WHERE actor_id=$1",
          [actor.actorId]
        )
      ).rows[0]!.total,
      0
    )
  } finally {
    await owner.query(
      "DROP TRIGGER personal_media_audit_failure ON audit_events; DROP FUNCTION public.fail_personal_media_audit()"
    )
  }
  await runtime.query(
    "SELECT public.publish_personal_media_upload($1,$2,$3,$4,4,$5,$6,$7)",
    [
      actor.actorId,
      actor.sessionId,
      operationId,
      leaseId,
      sha("same"),
      "image/png",
      randomUUID(),
    ]
  )
  await avatar(actor, uploaded.media.id, null)
})

type MaintenanceJob = {
  organizationId: string
  operationId: string
  mode: string
  operation: {
    phase: string
    committed_at: string | null
    completed_at: string | null
    lease_id: string
    lease_expires_at: string | null
    actor_type: string
    result: Record<string, unknown> | null
  }
  objects: {
    id: string
    entry_id: string | null
    version_id: string | null
    directory: boolean
    source_area: string | null
    source_path: string[] | null
    target_area: string | null
    target_path: string[] | null
    source_deleted_at: string | null
    source_restored_at: string | null
    target_deleted_at: string | null
  }[]
}
async function maintenanceClaim(
  organizationId: string,
  kind: string,
  id: string,
  leaseId = randomUUID()
) {
  const result = (
    await runtime.query<{ result: MaintenanceJob | null }>(
      "SELECT public.claim_file_maintenance($1,$2,$3,$4,$5) AS result",
      [organizationId, kind, id, leaseId, randomUUID()]
    )
  ).rows[0]!.result
  return { job: result, leaseId }
}
async function maintenanceFinish(job: MaintenanceJob, leaseId: string) {
  return (
    await runtime.query<{ result: MaintenanceJob }>(
      "SELECT public.finish_file_maintenance($1,$2,$3,$4) AS result",
      [job.organizationId, job.operationId, leaseId, randomUUID()]
    )
  ).rows[0]!.result
}
async function maintenanceFact(
  job: MaintenanceJob,
  leaseId: string,
  objectId: string,
  fact: string,
  bytes: number | null = null,
  hash: string | null = null
) {
  await runtime.query(
    "SELECT public.record_file_maintenance_object($1,$2,$3,$4,$5,$6,$7)",
    [job.organizationId, job.operationId, leaseId, objectId, fact, bytes, hash]
  )
}
async function expiredHistory(
  context: TenantContext,
  file: FileEntry,
  body = "history"
) {
  const versionId = randomUUID()
  // 固定过去的保留事实，实际清理由同一生产 SQL 通道执行，不等待 90 天。
  await owner.query(
    `INSERT INTO file_versions(id,organization_id,file_id,bytes,sha256,content_type,storage_area,storage_path,created_by,retired_at,expires_at)
    VALUES($1,$2,$3,$4,$5,'text/plain','history',$6,$7,now()-interval '91 days',now()-interval '1 day')`,
    [
      versionId,
      context.organizationId,
      file.id,
      Buffer.byteLength(body),
      sha(body),
      [file.id, versionId],
      context.userId,
    ]
  )
  await owner.query(
    "UPDATE file_storage_usage SET used_bytes=used_bytes+$2 WHERE organization_id=$1",
    [context.organizationId, Buffer.byteLength(body)]
  )
  return versionId
}
async function personalMaintenanceClaim(
  userId: string,
  kind: string,
  id: string,
  leaseId = randomUUID()
) {
  return {
    job: (
      await runtime.query(
        "SELECT public.claim_personal_media_maintenance($1,$2,$3,$4) AS result",
        [userId, kind, id, leaseId]
      )
    ).rows[0]!.result,
    leaseId,
  }
}
async function personalMaintenanceFinish(
  userId: string,
  kind: string,
  id: string,
  leaseId: string
) {
  return (
    await runtime.query(
      "SELECT public.finish_personal_media_maintenance($1,$2,$3,$4,$5) AS result",
      [userId, kind, id, leaseId, randomUUID()]
    )
  ).rows[0]!.result
}

test("用户组织操作严格续租不接管过期 token，系统 actor 不得缺失维护类型", async () => {
  const a = await workspace(),
    op = await run(a.context, (tx) => begin(tx, "upload")),
    leaseId = randomUUID(),
    now = new Date()
  await run(a.context, (tx) =>
    fileRepository.claimOperation(tx, op.id, leaseId, now, 1000)
  )
  const renewed = await run(a.context, (tx) =>
    fileRepository.renewOperation(
      tx,
      op.id,
      leaseId,
      new Date(now.getTime() + 500),
      1000
    )
  )
  assert.equal(renewed.leaseExpiresAt!.getTime(), now.getTime() + 1500)
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.renewOperation(tx, op.id, randomUUID(), now)
    ),
    errorCode("FILE_OPERATION_LEASE_CONFLICT")
  )
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.renewOperation(
        tx,
        op.id,
        leaseId,
        new Date(now.getTime() + 1501)
      )
    ),
    errorCode("FILE_OPERATION_LEASE_CONFLICT")
  )
  await assert.rejects(
    owner.query(
      "UPDATE file_operations SET actor_type='system',actor_id=NULL WHERE organization_id=$1 AND id=$2",
      [a.context.organizationId, op.id]
    ),
    sqlCode("23514")
  )
})

test("个人上传严格续租复核 Session，并拒绝过期和其他 token", async () => {
  const actor = await identityActor(),
    operationId = randomUUID(),
    leaseId = randomUUID()
  await runtime.query(
    "SELECT public.begin_personal_media_upload($1,$2,$3,$4,4,$5)",
    [actor.actorId, actor.sessionId, operationId, sha("renew"), randomUUID()]
  )
  await runtime.query(
    "SELECT public.claim_personal_media_upload($1,$2,$3,$4)",
    [actor.actorId, actor.sessionId, operationId, leaseId]
  )
  await assert.rejects(
    runtime.query("SELECT public.renew_personal_media_upload($1,$2,$3,$4)", [
      actor.actorId,
      actor.sessionId,
      operationId,
      randomUUID(),
    ]),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  const renewed = (
    await runtime.query(
      "SELECT public.renew_personal_media_upload($1,$2,$3,$4) AS result",
      [actor.actorId, actor.sessionId, operationId, leaseId]
    )
  ).rows[0]!.result
  assert.equal(renewed.lease_id, leaseId)
  assert.equal(Date.parse(renewed.lease_expires_at) > Date.now(), true)
  await owner.query(
    "UPDATE personal_media_operations SET lease_expires_at=now()-interval '1 second' WHERE user_id=$1 AND id=$2",
    [actor.actorId, operationId]
  )
  await assert.rejects(
    runtime.query("SELECT public.renew_personal_media_upload($1,$2,$3,$4)", [
      actor.actorId,
      actor.sessionId,
      operationId,
      leaseId,
    ]),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  await runtime.query(
    "SELECT public.claim_personal_media_upload($1,$2,$3,$4)",
    [actor.actorId, actor.sessionId, operationId, leaseId]
  )
  await owner.query("DELETE FROM session WHERE id=$1", [actor.sessionId])
  await assert.rejects(
    runtime.query("SELECT public.renew_personal_media_upload($1,$2,$3,$4)", [
      actor.actorId,
      actor.sessionId,
      operationId,
      leaseId,
    ]),
    databaseMessage("UNAUTHENTICATED")
  )
})

test("个人内容共享锁等待后重新校验 Session，等待期间撤销不能返回 locator", async () => {
  const actor = await identityActor(),
    uploaded = await personalUpload(actor),
    blocker = await owner.connect(),
    reader = await runtime.connect(),
    applicationName = `personal-read-${randomUUID()}`
  try {
    await blocker.query("BEGIN")
    await blocker.query(
      "SELECT id FROM personal_media WHERE id=$1 FOR UPDATE",
      [uploaded.media.id]
    )
    await reader.query("SELECT set_config('application_name',$1,false)", [
      applicationName,
    ])
    const pending = reader.query(
      "SELECT public.get_personal_media_content($1,$2,$3,NULL)",
      [actor.actorId, actor.sessionId, uploaded.media.id]
    )
    const rejection = assert.rejects(
      pending,
      databaseMessage("UNAUTHENTICATED")
    )
    let waiting = false
    for (let i = 0; i < 200; i++) {
      waiting = (
        await owner.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') AS waiting",
          [applicationName]
        )
      ).rows[0]!.waiting
      if (waiting) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(waiting, true)
    await owner.query("DELETE FROM session WHERE id=$1", [actor.sessionId])
    await blocker.query("COMMIT")
    await rejection
    assert.equal(
      (
        await owner.query("SELECT purged_at FROM personal_media WHERE id=$1", [
          uploaded.media.id,
        ])
      ).rows[0]!.purged_at,
      null
    )
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    reader.release()
  }
})

test("维护最小列授权和固定函数边界不开放文件名称、正文或业务引用", async () => {
  const result = (
    await runtime.query(`SELECT
    has_table_privilege('platform_executor','file_entries','SELECT') AS full_entries,
    has_column_privilege('platform_executor','file_entries','name','SELECT') AS names,
    has_column_privilege('platform_executor','file_entries','path','SELECT') AS paths,
    has_column_privilege('platform_executor','file_versions','content_type','SELECT') AS content,
    has_column_privilege('platform_executor','file_references','project_id','SELECT') AS projects,
    has_column_privilege('platform_executor','file_references','reference_key','SELECT') AS reference_keys,
    has_function_privilege('app_runtime','public.require_file_maintenance_lease(uuid,uuid,uuid,boolean)','EXECUTE') AS helper,
    has_function_privilege('platform_runtime','public.claim_file_maintenance(uuid,text,uuid,uuid,text)','EXECUTE') AS legacy,
    has_function_privilege('platform_deployer','public.claim_personal_media_maintenance(uuid,text,uuid,uuid)','EXECUTE') AS deployer`)
  ).rows[0]!
  for (const value of Object.values(result)) assert.equal(value, false)
  const a = await workspace(),
    file = await upload(a.context, a.root.id, "active.txt")
  assert.equal(
    (
      await maintenanceClaim(
        a.context.organizationId,
        "history",
        file.currentVersionId!
      )
    ).job,
    null
  )
  assert.equal(
    (await maintenanceClaim(a.context.organizationId, "trash", file.id)).job,
    null
  )
  const op = await run(a.context, (tx) => begin(tx, "upload"))
  assert.equal(
    (await maintenanceClaim(a.context.organizationId, "operation", op.id)).job,
    null
  )
  await assert.rejects(
    runtime.query("SELECT public.get_file_maintenance_candidates(101)"),
    databaseMessage("VALIDATION_ERROR")
  )
  const candidates = (
    await runtime.query(
      "SELECT public.get_file_maintenance_candidates(100) AS result"
    )
  ).rows[0]!.result as Record<string, unknown>[]
  for (const candidate of candidates)
    assert.deepEqual(Object.keys(candidate).sort(), [
      "id",
      "kind",
      "organizationId",
    ])
})

test("未引用历史到期清理只删除历史版本，认领互斥、严格续租与旧 token 拒绝", async () => {
  const a = await workspace(),
    file = await upload(a.context, a.root.id, "keep.txt", "live"),
    versionId = await expiredHistory(a.context, file, "past")
  const claims = await Promise.all([
    maintenanceClaim(a.context.organizationId, "history", versionId),
    maintenanceClaim(a.context.organizationId, "history", versionId),
  ])
  assert.equal(claims.filter((c) => c.job).length, 1)
  const { job, leaseId } = claims.find((c) => c.job)!,
    task = job!
  assert.equal(task.mode, "history_purge")
  assert.equal(task.operation.actor_type, "system")
  const busyCandidates = (
    await runtime.query(
      "SELECT public.get_file_maintenance_candidates(100) AS result"
    )
  ).rows[0]!.result as { id: string }[]
  assert.equal(
    busyCandidates.some((candidate) => candidate.id === versionId),
    false
  )
  assert.equal("plans" in task.operation, false)
  assert.equal("input" in task.operation, false)
  assert.deepEqual(task.objects[0]!.source_path, [file.id, versionId])
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.findVersion(tx, file.id, file.currentVersionId!)
    ),
    errorCode("FILE_OPERATION_IN_PROGRESS")
  )
  await runtime.query("SELECT public.renew_file_maintenance($1,$2,$3)", [
    task.organizationId,
    task.operationId,
    leaseId,
  ])
  await assert.rejects(
    runtime.query("SELECT public.renew_file_maintenance($1,$2,$3)", [
      task.organizationId,
      task.operationId,
      randomUUID(),
    ]),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  await owner.query(
    "UPDATE file_operations SET lease_expires_at=now()-interval '1 second' WHERE organization_id=$1 AND id=$2",
    [task.organizationId, task.operationId]
  )
  await assert.rejects(
    runtime.query("SELECT public.renew_file_maintenance($1,$2,$3)", [
      task.organizationId,
      task.operationId,
      leaseId,
    ]),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  const takeover = await maintenanceClaim(
    task.organizationId,
    "operation",
    task.operationId
  )
  assert.equal(takeover.job!.operationId, task.operationId)
  await assert.rejects(
    maintenanceFact(task, leaseId, task.objects[0]!.id, "source_deleted"),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  await assert.rejects(
    maintenanceFinish(task, takeover.leaseId),
    databaseMessage("FILE_OPERATION_NOT_READY")
  )
  await maintenanceFact(
    task,
    takeover.leaseId,
    task.objects[0]!.id,
    "source_deleted"
  )
  await maintenanceFact(
    task,
    takeover.leaseId,
    task.objects[0]!.id,
    "source_deleted"
  )
  const finished = await maintenanceFinish(task, takeover.leaseId)
  assert.equal(finished.operation.phase, "completed")
  assert.notEqual(finished.operation.committed_at, null)
  assert.notEqual(finished.operation.completed_at, null)
  await maintenanceFinish(task, takeover.leaseId)
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.usedBytes,
    4
  )
  const entry = (await run(a.context, (tx) =>
    fileRepository.findEntry(tx, file.id)
  ))!
  assert.equal(entry.state, "active")
  assert.equal(entry.revision, file.revision)
  assert.equal(entry.currentVersionId, file.currentVersionId)
  const facts = (
    await owner.query("SELECT purged_at FROM file_versions WHERE id=$1", [
      versionId,
    ])
  ).rows[0]!
  assert.notEqual(facts.purged_at, null)
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::integer AS total FROM audit_events WHERE operation_id=$1 AND event_code='file.history_purged' AND actor_type='system' AND actor_id IS NULL",
        [task.operationId]
      )
    ).rows[0]!.total,
    1
  )
})

test("历史引用排除到期清理，解除后才认领，当前版本永不清理", async () => {
  const a = await workspace(),
    file = await upload(a.context, a.root.id, "reference.txt"),
    versionId = await expiredHistory(a.context, file)
  const project = await run(a.context, (tx) =>
    projectRepository.create(tx, {
      name: "reference",
      description: null,
      contentLocale: "zh-CN",
    })
  )
  const business = {
    projectId: project.id,
    kind: "project_attachment" as const,
    locale: null,
  }
  await run(a.context, (tx) =>
    fileRepository.replaceReferences(tx, business, [
      { fileId: file.id, versionId, referenceKey: randomUUID(), position: 0 },
    ])
  )
  assert.equal(
    (await maintenanceClaim(a.context.organizationId, "history", versionId))
      .job,
    null
  )
  const candidates = (
    await runtime.query(
      "SELECT public.get_file_maintenance_candidates(100) AS result"
    )
  ).rows[0]!.result as { id: string }[]
  assert.equal(
    candidates.some((c) => c.id === versionId),
    false
  )
  await run(a.context, (tx) =>
    fileRepository.replaceReferences(tx, business, [])
  )
  const { job, leaseId } = await maintenanceClaim(
    a.context.organizationId,
    "history",
    versionId
  )
  assert.notEqual(job, null)
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.replaceReferences(tx, business, [
        { fileId: file.id, versionId, referenceKey: randomUUID(), position: 0 },
      ])
    ),
    errorCode("FILE_OPERATION_IN_PROGRESS")
  )
  await maintenanceFact(job!, leaseId, job!.objects[0]!.id, "source_deleted")
  await maintenanceFinish(job!, leaseId)
  assert.equal(
    (
      await maintenanceClaim(
        a.context.organizationId,
        "history",
        file.currentVersionId!
      )
    ).job,
    null
  )
})

test("回收批次到期清理保留独立子批次，停用组织和成员不存在仍按系统结算", async () => {
  const a = await workspace(),
    parent = await folder(a.context, a.root.id, "parent"),
    child = await folder(a.context, parent.id, "child"),
    file = await upload(a.context, child.id, "file.txt", "bytes")
  const deletedChild = await pathOperation(a.context, child, "trash", {
    now: new Date(Date.now() - 31 * 86400000),
  })
  const deletedParent = await pathOperation(a.context, parent, "trash", {
    now: new Date(Date.now() - 31 * 86400000),
  })
  await owner.query(
    "UPDATE organization_status SET status='SUSPENDED' WHERE organization_id=$1",
    [a.context.organizationId]
  )
  const parentTask = await maintenanceClaim(
    a.context.organizationId,
    "trash",
    deletedParent.id
  )
  assert.equal(parentTask.job!.objects.length, 1)
  assert.deepEqual(parentTask.job!.objects[0]!.source_path, [parent.id])
  await maintenanceFact(
    parentTask.job!,
    parentTask.leaseId,
    parentTask.job!.objects[0]!.id,
    "source_deleted"
  )
  await maintenanceFinish(parentTask.job!, parentTask.leaseId)
  assert.equal(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, child.id)))!
      .state,
    "trashed"
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.usedBytes,
    5
  )
  const childTask = await maintenanceClaim(
    a.context.organizationId,
    "trash",
    deletedChild.id
  )
  assert.equal(childTask.job!.objects.length, 2)
  assert.equal(
    childTask.job!.objects.some(
      (x) => x.entry_id === file.id && x.version_id === file.currentVersionId
    ),
    true
  )
  await assert.rejects(
    maintenanceFinish(childTask.job!, childTask.leaseId),
    databaseMessage("FILE_OPERATION_NOT_READY")
  )
  for (const object of childTask.job!.objects)
    await maintenanceFact(
      childTask.job!,
      childTask.leaseId,
      object.id,
      "source_deleted"
    )
  await maintenanceFinish(childTask.job!, childTask.leaseId)
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.usedBytes,
    0
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, file.id)))!
      .state,
    "purged"
  )
})

test("提交后维护只清理确切源，错误保留名称和容量，重跑完成后才允许重用", async () => {
  const a = await workspace(),
    file = await upload(a.context, a.root.id, "source.txt", "body"),
    operation = await run(a.context, (tx) => begin(tx, "rename"))
  const preparedPath = await run(a.context, (tx) =>
    fileRepository.preparePathOperation(tx, operation.id, {
      entryId: file.id,
      expectedRevision: file.revision,
      name: "target.txt",
      now: new Date(),
    })
  )
  await run(a.context, async (tx) => {
    await prepared(tx, operation.id, preparedPath.objects)
    await fileRepository.commitPathOperation(tx, operation.id, new Date())
  })
  const { job, leaseId } = await maintenanceClaim(
    a.context.organizationId,
    "operation",
    operation.id
  )
  assert.equal(job!.mode, "finish_commit")
  await assert.rejects(
    maintenanceFact(job!, leaseId, job!.objects[0]!.id, "target_deleted"),
    databaseMessage("FILE_OPERATION_NOT_READY")
  )
  await runtime.query(
    "SELECT public.record_file_maintenance_error($1,$2,$3,$4)",
    [job!.organizationId, job!.operationId, leaseId, "STORAGE_UNAVAILABLE"]
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.transientBytes,
    4
  )
  await assert.rejects(
    upload(a.context, a.root.id, "source.txt"),
    errorCode("FILE_OPERATION_IN_PROGRESS")
  )
  const next = await maintenanceClaim(
    a.context.organizationId,
    "operation",
    operation.id
  )
  await maintenanceFact(
    next.job!,
    next.leaseId,
    next.job!.objects[0]!.id,
    "source_deleted"
  )
  await maintenanceFinish(next.job!, next.leaseId)
  const reopened = await upload(a.context, a.root.id, "source.txt")
  assert.notEqual(reopened.id, file.id)
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.transientBytes,
    0
  )
})

test("过期未提交操作必须恢复已删除源并删除所有目标，才释放预留和 busy", async () => {
  const a = await workspace(),
    file = await upload(a.context, a.root.id, "old.txt", "keep"),
    op = await run(a.context, (tx) => begin(tx, "rename"))
  const result = await run(a.context, (tx) =>
    fileRepository.preparePathOperation(tx, op.id, {
      entryId: file.id,
      expectedRevision: file.revision,
      name: "new.txt",
      now: new Date(),
    })
  )
  await run(a.context, async (tx) => {
    await prepared(tx, op.id, result.objects)
    await fileRepository.recordObjectDeleted(
      tx,
      op.id,
      result.objects[0]!.id,
      "source",
      new Date()
    )
  })
  await owner.query(
    "UPDATE file_operations SET expires_at=now()-interval '1 second' WHERE organization_id=$1 AND id=$2",
    [a.context.organizationId, op.id]
  )
  const { job, leaseId } = await maintenanceClaim(
    a.context.organizationId,
    "operation",
    op.id
  )
  assert.equal(job!.mode, "abort_uncommitted")
  await assert.rejects(
    maintenanceFinish(job!, leaseId),
    databaseMessage("FILE_OPERATION_NOT_READY")
  )
  await assert.rejects(
    maintenanceFact(
      job!,
      leaseId,
      job!.objects[0]!.id,
      "source_restored",
      4,
      sha("fake")
    ),
    databaseMessage("FILE_CONTENT_MISMATCH")
  )
  await maintenanceFact(
    job!,
    leaseId,
    job!.objects[0]!.id,
    "source_restored",
    4,
    sha("keep")
  )
  await assert.rejects(
    maintenanceFinish(job!, leaseId),
    databaseMessage("FILE_OPERATION_NOT_READY")
  )
  await maintenanceFact(job!, leaseId, job!.objects[0]!.id, "target_deleted")
  const finished = await maintenanceFinish(job!, leaseId)
  assert.equal(finished.operation.phase, "failed")
  assert.equal(finished.operation.committed_at, null)
  assert.equal(finished.operation.completed_at, null)
  assert.equal(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, file.id)))!
      .busyOperationId,
    null
  )
  assert.deepEqual(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, file.id)))!.path,
    ["old.txt"]
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.transientBytes,
    0
  )
  const uploadOp = await run(a.context, async (tx) => {
    const op = await begin(tx, "upload")
    await fileRepository.reserveUpload(tx, op.id, {
      parentId: a.root.id,
      name: "expired.txt",
      declaredBytes: 10,
    })
    return op
  })
  await owner.query(
    "UPDATE file_operations SET expires_at=now()-interval '1 second' WHERE organization_id=$1 AND id=$2",
    [a.context.organizationId, uploadOp.id]
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.reservedBytes,
    10
  )
  const uploadTask = await maintenanceClaim(
    a.context.organizationId,
    "operation",
    uploadOp.id
  )
  await maintenanceFinish(uploadTask.job!, uploadTask.leaseId)
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.reservedBytes,
    0
  )
})

test("用户 purge 物理删除后审计失败仍保留意图和容量，系统续跑诚实审计并只结算一次", async () => {
  const a = await workspace(),
    file = await upload(a.context, a.root.id, "irreversible.txt", "charge"),
    trashed = await pathOperation(a.context, file, "trash"),
    op = await run(a.context, (tx) => begin(tx, "purge"))
  const result = await run(a.context, (tx) =>
    fileRepository.preparePathOperation(tx, op.id, {
      entryId: file.id,
      expectedRevision: trashed.revision,
      now: new Date(),
    })
  )
  await run(a.context, (tx) =>
    fileRepository.recordObjectDeleted(
      tx,
      op.id,
      result.objects[0]!.id,
      "source",
      new Date()
    )
  )
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.failOperation(tx, op.id, "STORAGE_UNAVAILABLE", new Date())
    ),
    errorCode("FILE_OPERATION_NOT_READY")
  )
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.recordSourceRestored(
        tx,
        op.id,
        result.objects[0]!.id,
        { bytes: 6, sha256: sha("charge") },
        new Date()
      )
    ),
    errorCode("FILE_OPERATION_NOT_READY")
  )
  const { job, leaseId } = await maintenanceClaim(
    a.context.organizationId,
    "operation",
    op.id
  )
  assert.equal(job!.mode, "finish_purge")
  assert.equal(job!.operation.committed_at, null)
  assert.equal(job!.objects[0]!.target_area, null)
  for (const object of job!.objects)
    await maintenanceFact(job!, leaseId, object.id, "source_deleted")
  await owner.query(`CREATE FUNCTION public.fail_files_maintenance_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.operation_id='${op.id}' THEN RAISE EXCEPTION 'maintenance audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER files_maintenance_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION public.fail_files_maintenance_audit()`)
  try {
    await assert.rejects(
      maintenanceFinish(job!, leaseId),
      databaseMessage("AUDIT_UNAVAILABLE")
    )
    const failed = (
      await owner.query(
        "SELECT state,busy_operation_id FROM file_entries WHERE id=$1",
        [file.id]
      )
    ).rows[0]!
    assert.equal(failed.state, "trashed")
    assert.equal(failed.busy_operation_id, op.id)
    assert.equal(
      (await run(a.context, (tx) => fileRepository.usage(tx)))!.usedBytes,
      6
    )
    const facts = (
      await owner.query(
        "SELECT committed_at,actor_id,actor_type FROM file_operations WHERE organization_id=$1 AND id=$2",
        [a.context.organizationId, op.id]
      )
    ).rows[0]!
    assert.equal(facts.committed_at, null)
    assert.equal(facts.actor_type, "user")
    assert.equal(facts.actor_id, a.context.userId)
    assert.equal(
      (
        await owner.query(
          "SELECT source_deleted_at FROM file_operation_objects WHERE id=$1",
          [result.objects[0]!.id]
        )
      ).rows[0]!.source_deleted_at !== null,
      true
    )
  } finally {
    await owner.query(
      "DROP TRIGGER files_maintenance_audit_failure ON audit_events; DROP FUNCTION public.fail_files_maintenance_audit()"
    )
  }
  await maintenanceFinish(job!, leaseId)
  await maintenanceFinish(job!, leaseId)
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.usedBytes,
    0
  )
  const audit = (
    await owner.query(
      "SELECT actor_type,actor_id,fields FROM audit_events WHERE operation_id=$1 AND event_code='file.purged'",
      [op.id]
    )
  ).rows
  assert.equal(audit.length, 1)
  assert.equal(audit[0]!.actor_type, "system")
  assert.equal(audit[0]!.actor_id, null)
  assert.equal(audit[0]!.fields.initiatedBy, a.context.userId)
})

test("个人当前头像不被认领；过期旧媒体删除故障保留事实并由新 lease 完成", async () => {
  const actor = await identityActor(),
    first = await personalUpload(actor, "first"),
    next = await personalUpload(actor, "next")
  const image = (await avatar(actor, first.media.id, null)).image
  await avatar(actor, next.media.id, image)
  await owner.query(
    "UPDATE personal_media SET expires_at=now()-interval '1 second' WHERE user_id=$1 AND id=$2",
    [actor.actorId, first.media.id]
  )
  assert.equal(
    (await personalMaintenanceClaim(actor.actorId, "media", next.media.id)).job,
    null
  )
  const claims = await Promise.all([
    personalMaintenanceClaim(actor.actorId, "media", first.media.id),
    personalMaintenanceClaim(actor.actorId, "media", first.media.id),
  ])
  assert.equal(claims.filter((c) => c.job).length, 1)
  const { job, leaseId } = claims.find((c) => c.job)!
  assert.deepEqual(job.storagePath, [first.media.id])
  assert.equal(job.operationId !== null, true)
  await runtime.query(
    "SELECT public.renew_personal_media_maintenance($1,$2,$3,$4)",
    [actor.actorId, "media", first.media.id, leaseId]
  )
  await runtime.query(
    "SELECT public.record_personal_media_maintenance_error($1,$2,$3,$4,$5)",
    [actor.actorId, "media", first.media.id, leaseId, "STORAGE_UNAVAILABLE"]
  )
  assert.equal(
    (
      await owner.query("SELECT purged_at FROM personal_media WHERE id=$1", [
        first.media.id,
      ])
    ).rows[0]!.purged_at,
    null
  )
  await assert.rejects(
    runtime.query(
      "SELECT public.renew_personal_media_maintenance($1,$2,$3,$4)",
      [actor.actorId, "media", first.media.id, leaseId]
    ),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  const takeover = await personalMaintenanceClaim(
    actor.actorId,
    "media",
    first.media.id
  )
  assert.equal(takeover.job.operationId, job.operationId)
  await assert.rejects(
    personalMaintenanceFinish(actor.actorId, "media", first.media.id, leaseId),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  await personalMaintenanceFinish(
    actor.actorId,
    "media",
    first.media.id,
    takeover.leaseId
  )
  await personalMaintenanceFinish(
    actor.actorId,
    "media",
    first.media.id,
    takeover.leaseId
  )
  assert.equal((await personalRead(actor, next.media.id)).id, next.media.id)
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::integer AS total FROM audit_events WHERE operation_id=$1 AND event_code='personal_media.purged' AND actor_type='system' AND actor_id IS NULL",
        [job.operationId]
      )
    ).rows[0]!.total,
    1
  )
})

test("过期个人上传无 Session 也清理固定目标，审计故障不标记已清理", async () => {
  const actor = await identityActor(),
    operationId = randomUUID()
  const begun = (
    await runtime.query(
      "SELECT public.begin_personal_media_upload($1,$2,$3,$4,4,$5) AS result",
      [
        actor.actorId,
        actor.sessionId,
        operationId,
        sha("abandoned"),
        randomUUID(),
      ]
    )
  ).rows[0]!.result
  await owner.query("DELETE FROM session WHERE id=$1", [actor.sessionId])
  await owner.query(
    "UPDATE personal_media_operations SET expires_at=now()-interval '1 second' WHERE user_id=$1 AND id=$2",
    [actor.actorId, operationId]
  )
  const candidates = (
    await runtime.query(
      "SELECT public.get_personal_media_maintenance_candidates(100) AS result"
    )
  ).rows[0]!.result as { id: string; kind: string }[]
  assert.equal(
    candidates.some((c) => c.id === operationId && c.kind === "upload"),
    true
  )
  const { job, leaseId } = await personalMaintenanceClaim(
    actor.actorId,
    "upload",
    operationId
  )
  assert.deepEqual(job.storagePath, [begun.operation.media_id])
  await owner.query(`CREATE FUNCTION public.fail_personal_cleanup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.operation_id='${operationId}' THEN RAISE EXCEPTION 'personal cleanup audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER personal_cleanup_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION public.fail_personal_cleanup_audit()`)
  try {
    await assert.rejects(
      personalMaintenanceFinish(actor.actorId, "upload", operationId, leaseId),
      databaseMessage("AUDIT_UNAVAILABLE")
    )
    const facts = (
      await owner.query(
        "SELECT phase,cleaned_at FROM personal_media_operations WHERE user_id=$1 AND id=$2",
        [actor.actorId, operationId]
      )
    ).rows[0]!
    assert.equal(facts.phase, "preparing")
    assert.equal(facts.cleaned_at, null)
  } finally {
    await owner.query(
      "DROP TRIGGER personal_cleanup_audit_failure ON audit_events; DROP FUNCTION public.fail_personal_cleanup_audit()"
    )
  }
  const finished = await personalMaintenanceFinish(
    actor.actorId,
    "upload",
    operationId,
    leaseId
  )
  assert.equal(finished.phase, "failed")
  assert.equal(finished.cleanedAt !== null, true)
  await personalMaintenanceFinish(actor.actorId, "upload", operationId, leaseId)
  assert.equal(
    (await personalMaintenanceClaim(actor.actorId, "upload", operationId)).job,
    null
  )
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::integer AS total FROM personal_media WHERE user_id=$1",
        [actor.actorId]
      )
    ).rows[0]!.total,
    0
  )
})

test("正式操作已知失败用严格 token 移交后立即清理，不等待24h或伪造成员上下文", async () => {
  const a = await workspace(),
    operation = await run(a.context, (tx) => begin(tx, "upload")),
    leaseId = randomUUID(),
    fileId = randomUUID(),
    versionId = randomUUID()
  await run(a.context, (tx) =>
    fileRepository.claimOperation(tx, operation.id, leaseId, new Date())
  )
  const objects = await run(a.context, async (tx) => {
    await fileRepository.reserveUpload(tx, operation.id, {
      parentId: a.root.id,
      name: "failed.txt",
      declaredBytes: 4,
    })
    const objects = await fileRepository.addObjects(tx, operation.id, [
      {
        entryId: fileId,
        versionId,
        directory: false,
        targetArea: "files",
        targetPath: ["failed.txt"],
        expectedBytes: 4,
        expectedSha256: sha("body"),
      },
    ])
    await prepared(tx, operation.id, objects)
    return objects
  })
  assert.equal(
    (
      await maintenanceClaim(
        a.context.organizationId,
        "operation",
        operation.id
      )
    ).job,
    null
  )
  await assert.rejects(
    runtime.query("SELECT public.handoff_file_operation_failure($1,$2,$3,$4)", [
      a.context.organizationId,
      operation.id,
      randomUUID(),
      "FORBIDDEN",
    ]),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  await owner.query(
    "UPDATE organization_status SET status='SUSPENDED' WHERE organization_id=$1",
    [a.context.organizationId]
  )
  await owner.query(
    "UPDATE file_operations SET lease_expires_at=now()-interval '1 second' WHERE organization_id=$1 AND id=$2",
    [a.context.organizationId, operation.id]
  )
  await runtime.query(
    "SELECT public.handoff_file_operation_failure($1,$2,$3,$4)",
    [a.context.organizationId, operation.id, leaseId, "FORBIDDEN"]
  )
  const candidates = (
    await runtime.query(
      "SELECT public.get_file_maintenance_candidates(100) AS result"
    )
  ).rows[0]!.result as { id: string }[]
  assert.equal(
    candidates.some((c) => c.id === operation.id),
    true
  )
  const next = await maintenanceClaim(
    a.context.organizationId,
    "operation",
    operation.id
  )
  assert.equal(next.job!.mode, "abort_uncommitted")
  await assert.rejects(
    runtime.query("SELECT public.handoff_file_operation_failure($1,$2,$3,$4)", [
      a.context.organizationId,
      operation.id,
      leaseId,
      "FORBIDDEN",
    ]),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  await assert.rejects(
    maintenanceFinish(next.job!, next.leaseId),
    databaseMessage("FILE_OPERATION_NOT_READY")
  )
  await maintenanceFact(
    next.job!,
    next.leaseId,
    objects[0]!.id,
    "target_deleted"
  )
  const finished = await maintenanceFinish(next.job!, next.leaseId)
  assert.equal(finished.operation.phase, "failed")
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.reservedBytes,
    0
  )
  const fact = (
    await owner.query(
      "SELECT actor_id,actor_type,request_hash,error_code FROM file_operations WHERE organization_id=$1 AND id=$2",
      [a.context.organizationId, operation.id]
    )
  ).rows[0]!
  assert.equal(fact.actor_id, a.context.userId)
  assert.equal(fact.actor_type, "user")
  assert.equal(fact.request_hash, operation.requestHash)
  assert.equal(fact.error_code, "FORBIDDEN")
})

test("单file回收和恢复记录内部目录，不增加UI项；source-only目录无需prepared但必须清理", async () => {
  const a = await workspace(),
    file = await upload(a.context, a.root.id, "single.txt"),
    trashOp = await run(a.context, (tx) => begin(tx, "trash"))
  const trashPlan = await run(a.context, (tx) =>
    fileRepository.preparePathOperation(tx, trashOp.id, {
      entryId: file.id,
      expectedRevision: file.revision,
      now: new Date(),
    })
  )
  const internal = trashPlan.objects.find((x) => x.entryId === null)!
  assert.equal(internal.directory, true)
  assert.equal(internal.sourceArea, null)
  assert.equal(internal.targetArea, "trash")
  assert.deepEqual(internal.targetPath, [file.id])
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.commitPathOperation(tx, trashOp.id, new Date())
    ),
    errorCode("FILE_OPERATION_NOT_READY")
  )
  await run(a.context, async (tx) => {
    await prepared(tx, trashOp.id, trashPlan.objects)
    await fileRepository.commitPathOperation(tx, trashOp.id, new Date())
    await complete(tx, trashOp.id, trashPlan.objects)
  })
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::integer AS total FROM file_entries WHERE organization_id=$1",
        [a.context.organizationId]
      )
    ).rows[0]!.total,
    2
  )
  const trashed = (await run(a.context, (tx) =>
      fileRepository.findEntry(tx, file.id)
    ))!,
    restoreOp = await run(a.context, (tx) => begin(tx, "restore"))
  const restorePlan = await run(a.context, (tx) =>
    fileRepository.preparePathOperation(tx, restoreOp.id, {
      entryId: file.id,
      expectedRevision: trashed.revision,
      now: new Date(),
    })
  )
  const sourceDirectory = restorePlan.objects.find((x) => x.entryId === null)!
  assert.equal(sourceDirectory.targetArea, null)
  assert.equal(sourceDirectory.sourceArea, "trash")
  assert.deepEqual(sourceDirectory.sourcePath, [file.id])
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.recordPreparedObject(
        tx,
        restoreOp.id,
        sourceDirectory.id,
        { bytes: 0, sha256: null, transientBytes: 0 }
      )
    ),
    errorCode("FILE_OPERATION_NOT_READY")
  )
  await run(a.context, async (tx) => {
    await prepared(tx, restoreOp.id, restorePlan.objects)
    await fileRepository.commitPathOperation(tx, restoreOp.id, new Date())
  })
  for (const object of restorePlan.objects.filter((x) => x.entryId !== null))
    await run(a.context, (tx) =>
      fileRepository.recordObjectDeleted(
        tx,
        restoreOp.id,
        object.id,
        "source",
        new Date()
      )
    )
  await assert.rejects(
    run(a.context, (tx) =>
      fileRepository.finishOperation(tx, restoreOp.id, new Date())
    ),
    errorCode("FILE_OPERATION_NOT_READY")
  )
  await run(a.context, async (tx) => {
    await fileRepository.recordObjectDeleted(
      tx,
      restoreOp.id,
      sourceDirectory.id,
      "source",
      new Date()
    )
    await fileRepository.finishOperation(tx, restoreOp.id, new Date())
  })
  assert.deepEqual(
    (await run(a.context, (tx) => fileRepository.findEntry(tx, file.id)))!.path,
    ["single.txt"]
  )
  await assert.rejects(
    owner.query(
      "INSERT INTO file_operation_objects(organization_id,operation_id,entry_id,directory,source_area,source_path) VALUES($1,$2,NULL,false,'trash',$3)",
      [a.context.organizationId, restoreOp.id, [file.id]]
    ),
    sqlCode("23514")
  )
})

test("从folder回收批次恢复单file不清理仍被兄弟共享的批次根", async () => {
  const a = await workspace(),
    directory = await folder(a.context, a.root.id, "batch"),
    first = await upload(a.context, directory.id, "first.txt"),
    second = await upload(a.context, directory.id, "second.txt")
  await pathOperation(a.context, directory, "trash")
  const trashed = (await run(a.context, (tx) =>
      fileRepository.findEntry(tx, first.id)
    ))!,
    op = await run(a.context, (tx) => begin(tx, "restore"))
  const plan = await run(a.context, (tx) =>
    fileRepository.preparePathOperation(tx, op.id, {
      entryId: first.id,
      expectedRevision: trashed.revision,
      parentId: a.root.id,
      now: new Date(),
    })
  )
  assert.equal(plan.objects.length, 1)
  assert.equal(plan.objects[0]!.entryId, first.id)
  assert.equal(
    plan.objects.some(
      (x) =>
        x.directory &&
        JSON.stringify(x.sourcePath) === JSON.stringify([directory.id])
    ),
    false
  )
  await run(a.context, async (tx) => {
    await prepared(tx, op.id, plan.objects)
    await fileRepository.commitPathOperation(tx, op.id, new Date())
    await complete(tx, op.id, plan.objects)
  })
  const remaining = (await run(a.context, (tx) =>
    fileRepository.findEntry(tx, second.id)
  ))!
  assert.equal(remaining.state, "trashed")
  assert.equal(remaining.trashRootId, directory.id)
})

test("系统单file到期 purge 在文件和内部批次目录均删除后才结算", async () => {
  const a = await workspace(),
    file = await upload(a.context, a.root.id, "expired-single.txt", "size")
  await pathOperation(a.context, file, "trash", {
    now: new Date(Date.now() - 31 * 86400000),
  })
  const { job, leaseId } = await maintenanceClaim(
    a.context.organizationId,
    "trash",
    file.id
  )
  assert.equal(job!.objects.length, 2)
  const content = job!.objects.find((x) => !x.directory)!,
    internal = job!.objects.find((x) => x.entry_id === null)!
  assert.equal(internal.directory, true)
  assert.deepEqual(internal.source_path, [file.id])
  assert.equal(internal.target_area, null)
  await maintenanceFact(job!, leaseId, content.id, "source_deleted")
  await assert.rejects(
    maintenanceFinish(job!, leaseId),
    databaseMessage("FILE_OPERATION_NOT_READY")
  )
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.usedBytes,
    4
  )
  await maintenanceFact(job!, leaseId, internal.id, "source_deleted")
  await maintenanceFinish(job!, leaseId)
  assert.equal(
    (await run(a.context, (tx) => fileRepository.usage(tx)))!.usedBytes,
    0
  )
})

test("个人上传 Session撤销后以当前 token 立即移交，过期未接管只移交错误，新 token 接管后旧 token 拒绝", async () => {
  const actor = await identityActor(),
    operationId = randomUUID(),
    leaseId = randomUUID()
  const begun = (
    await runtime.query(
      "SELECT public.begin_personal_media_upload($1,$2,$3,$4,4,$5) AS result",
      [
        actor.actorId,
        actor.sessionId,
        operationId,
        sha("handoff"),
        randomUUID(),
      ]
    )
  ).rows[0]!.result
  await runtime.query(
    "SELECT public.claim_personal_media_upload($1,$2,$3,$4)",
    [actor.actorId, actor.sessionId, operationId, leaseId]
  )
  assert.equal(
    (await personalMaintenanceClaim(actor.actorId, "upload", operationId)).job,
    null
  )
  await assert.rejects(
    runtime.query(
      "SELECT public.handoff_personal_media_upload_failure($1,$2,$3,$4)",
      [actor.actorId, operationId, randomUUID(), "UNAUTHENTICATED"]
    ),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  await owner.query("DELETE FROM session WHERE id=$1", [actor.sessionId])
  await owner.query(
    "UPDATE personal_media_operations SET lease_expires_at=now()-interval '1 second' WHERE user_id=$1 AND id=$2",
    [actor.actorId, operationId]
  )
  await runtime.query(
    "SELECT public.handoff_personal_media_upload_failure($1,$2,$3,$4)",
    [actor.actorId, operationId, leaseId, "UNAUTHENTICATED"]
  )
  const before = (
    await owner.query(
      "SELECT user_id,media_id,request_hash,phase,committed_at,expires_at,error_code FROM personal_media_operations WHERE user_id=$1 AND id=$2",
      [actor.actorId, operationId]
    )
  ).rows[0]!
  assert.equal(before.user_id, actor.actorId)
  assert.equal(before.media_id, begun.operation.media_id)
  assert.equal(before.request_hash, sha("handoff"))
  assert.equal(before.phase, "preparing")
  assert.equal(before.committed_at, null)
  assert.equal(before.expires_at.getTime() > Date.now(), true)
  assert.equal(before.error_code, "UNAUTHENTICATED")
  const candidates = (
    await runtime.query(
      "SELECT public.get_personal_media_maintenance_candidates(100) AS result"
    )
  ).rows[0]!.result as { id: string; kind: string }[]
  assert.equal(
    candidates.some((c) => c.id === operationId && c.kind === "upload"),
    true
  )
  const { job, leaseId: nextLease } = await personalMaintenanceClaim(
    actor.actorId,
    "upload",
    operationId
  )
  assert.deepEqual(job.storagePath, [begun.operation.media_id])
  await assert.rejects(
    runtime.query(
      "SELECT public.handoff_personal_media_upload_failure($1,$2,$3,$4)",
      [actor.actorId, operationId, leaseId, "UNAUTHENTICATED"]
    ),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  const finished = await personalMaintenanceFinish(
    actor.actorId,
    "upload",
    operationId,
    nextLease
  )
  assert.equal(finished.phase, "failed")
  assert.notEqual(finished.cleanedAt, null)
  assert.equal(finished.errorCode, "UNAUTHENTICATED")
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::integer AS total FROM personal_media WHERE user_id=$1",
        [actor.actorId]
      )
    ).rows[0]!.total,
    0
  )
})

test("个人发布已成功但响应未知或头像CAS失败均不移交删除已发布媒体", async () => {
  const actor = await identityActor(),
    uploaded = await personalUpload(actor)
  await assert.rejects(
    runtime.query(
      "SELECT public.handoff_personal_media_upload_failure($1,$2,$3,$4)",
      [actor.actorId, uploaded.operationId, uploaded.leaseId, "UNAUTHENTICATED"]
    ),
    databaseMessage("FILE_OPERATION_LEASE_CONFLICT")
  )
  assert.equal(
    (
      await personalMaintenanceClaim(
        actor.actorId,
        "upload",
        uploaded.operationId
      )
    ).job,
    null
  )
  await assert.rejects(
    avatar(actor, uploaded.media.id, "changed-image"),
    databaseMessage("VERSION_CONFLICT")
  )
  assert.equal(
    (await personalMaintenanceClaim(actor.actorId, "media", uploaded.media.id))
      .job,
    null
  )
  assert.equal(
    (await personalRead(actor, uploaded.media.id)).id,
    uploaded.media.id
  )
  const operation = (
    await owner.query(
      "SELECT phase,committed_at FROM personal_media_operations WHERE user_id=$1 AND id=$2",
      [actor.actorId, uploaded.operationId]
    )
  ).rows[0]!
  assert.equal(operation.phase, "completed")
  assert.notEqual(operation.committed_at, null)
})

test("平台策略读取等待后复核 Session，不能返回已失效身份的摘要", async () => {
  const a = await workspace(),
    actor = await platformActor("platform_auditor")
  const blocker = await owner.connect(),
    reader = await runtime.connect()
  const applicationName = `storage-read-${randomUUID()}`
  try {
    await blocker.query("BEGIN")
    await blocker.query(
      "UPDATE file_storage_usage SET used_bytes=used_bytes WHERE organization_id=$1",
      [a.context.organizationId]
    )
    await reader.query("SELECT set_config('application_name',$1,false)", [
      applicationName,
    ])
    const pending = reader.query(
      "SELECT public.get_platform_storage_policy($1,$2,$3,$4)",
      [actor.actorId, actor.sessionId, a.context.organizationId, randomUUID()]
    )
    const rejection = assert.rejects(pending, databaseMessage("FORBIDDEN"))
    let waiting = false
    for (let i = 0; i < 200; i++) {
      waiting = (
        await owner.query(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') AS waiting",
          [applicationName]
        )
      ).rows[0]!.waiting
      if (waiting) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(waiting, true)
    await owner.query(
      "UPDATE public.session SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [actor.sessionId]
    )
    await blocker.query("COMMIT")
    await rejection
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::integer AS total FROM audit_events WHERE organization_id=$1 AND event_code='platform.storage_policy_viewed'",
          [a.context.organizationId]
        )
      ).rows[0]!.total,
      0
    )
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    reader.release()
  }
})

async function actorWorkspace() {
  const a = await workspace(),
    sessionId = randomUUID(),
    ownerId = randomUUID()
  await owner.query(
    "INSERT INTO public.\"user\" (id,name,email,email_verified) VALUES ($1,'file owner',$2,true)",
    [ownerId, `${ownerId}@example.test`]
  )
  await owner.query(
    "INSERT INTO public.member (id,organization_id,user_id,role,created_at) VALUES ($1,$2,$3,'owner',now())",
    [randomUUID(), a.context.organizationId, ownerId]
  )
  await owner.query(
    "INSERT INTO public.\"user\" (id,name,email,email_verified) VALUES ($1,'file actor',$2,true)",
    [a.context.userId, `${a.context.userId}@example.test`]
  )
  await owner.query(
    "INSERT INTO public.session (id,user_id,token,expires_at,updated_at) VALUES ($1,$2,$3,now()+interval '1 hour',now())",
    [sessionId, a.context.userId, randomUUID()]
  )
  await owner.query(
    "INSERT INTO public.member (id,organization_id,user_id,role,created_at) VALUES ($1,$2,$3,'member',now())",
    [a.context.membershipId, a.context.organizationId, a.context.userId]
  )
  return { ...a, sessionId }
}
async function currentActor(context: TenantContext, sessionId: string) {
  return run(context, async (tx) => {
    await fileRepository.lockOrganization(tx)
    return fileRepository.requireCurrentActor(tx, sessionId)
  })
}
async function waitForActorLock(applicationName: string) {
  for (let i = 0; i < 200; i++) {
    if (
      (
        await owner.query(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') AS waiting",
          [applicationName]
        )
      ).rows[0]!.waiting
    )
      return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail("actor transaction did not reach its required row lock")
}

test("文件执行边界核对真实Session和精确成员，返回锁后数据库当前时间", async () => {
  const a = await actorWorkspace(),
    b = await actorWorkspace()
  await run(a.context, async (tx) => {
    await fileRepository.lockOrganization(tx)
    const began = (
      await tx.execute<{ began: string }>(
        sql`SELECT transaction_timestamp() AS began`
      )
    ).rows[0]!.began
    await tx.execute(sql`SELECT pg_sleep(0.01)`)
    const now = await fileRepository.requireCurrentActor(tx, a.sessionId)
    assert.equal(now instanceof Date, true)
    assert.ok(now.getTime() > new Date(began).getTime())
  })
  await assert.rejects(
    currentActor(a.context, randomUUID()),
    errorCode("UNAUTHENTICATED")
  )
  await assert.rejects(
    currentActor(a.context, b.sessionId),
    errorCode("UNAUTHENTICATED")
  )
  await assert.rejects(
    currentActor(
      { ...a.context, membershipId: b.context.membershipId },
      a.sessionId
    ),
    errorCode("FORBIDDEN")
  )
  await assert.rejects(
    currentActor(
      { ...a.context, organizationId: b.context.organizationId },
      a.sessionId
    ),
    errorCode("FORBIDDEN")
  )
  await owner.query(
    "UPDATE session SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [a.sessionId]
  )
  await assert.rejects(
    currentActor(a.context, a.sessionId),
    errorCode("UNAUTHENTICATED")
  )
  await owner.query(
    "UPDATE session SET expires_at=now()+interval '1 hour' WHERE id=$1",
    [a.sessionId]
  )
  await owner.query("DELETE FROM member WHERE id=$1", [a.context.membershipId])
  await assert.rejects(
    currentActor(a.context, a.sessionId),
    errorCode("FORBIDDEN")
  )
})

test("文件执行边界维持Active状态错误，失效Session先于组织状态信息拒绝", async () => {
  const a = await actorWorkspace()
  await owner.query(
    "UPDATE organization_status SET status='SUSPENDED' WHERE organization_id=$1",
    [a.context.organizationId]
  )
  await assert.rejects(currentActor(a.context, a.sessionId), sqlCode("ORS02"))
  await owner.query(
    "UPDATE session SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [a.sessionId]
  )
  await assert.rejects(
    currentActor(a.context, a.sessionId),
    errorCode("UNAUTHENTICATED")
  )
  const b = await actorWorkspace()
  await owner.query(
    "DELETE FROM organization_status WHERE organization_id=$1",
    [b.context.organizationId]
  )
  await assert.rejects(currentActor(b.context, b.sessionId), sqlCode("ORS01"))
})

test("等待Session行锁后核对最新撤销事实，不继续取组织状态", async () => {
  const a = await actorWorkspace(),
    blocker = await owner.connect(),
    client = await runtime.connect()
  const applicationName = `actor-session-${randomUUID()}`
  try {
    await blocker.query("BEGIN")
    await blocker.query("SELECT id FROM session WHERE id=$1 FOR UPDATE", [
      a.sessionId,
    ])
    await client.query("SELECT set_config('application_name',$1,false)", [
      applicationName,
    ])
    const pending = createTenantRunner(client)(a.context, async (tx) => {
      await fileRepository.lockOrganization(tx)
      return fileRepository.requireCurrentActor(tx, a.sessionId)
    })
    const rejection = assert.rejects(pending, errorCode("UNAUTHENTICATED"))
    await waitForActorLock(applicationName)
    await blocker.query(
      "UPDATE session SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [a.sessionId]
    )
    await blocker.query("COMMIT")
    await rejection
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    client.release()
  }
})

test("等待原生组织状态锁后成员已移除，执行边界拒绝旧成员上下文", async () => {
  const a = await actorWorkspace(),
    blocker = await owner.connect(),
    client = await runtime.connect()
  const applicationName = `actor-member-${randomUUID()}`
  try {
    await blocker.query("BEGIN")
    await blocker.query("SELECT public.require_active_organization($1)", [
      a.context.organizationId,
    ])
    await blocker.query("DELETE FROM member WHERE id=$1", [
      a.context.membershipId,
    ])
    await client.query("SELECT set_config('application_name',$1,false)", [
      applicationName,
    ])
    const pending = createTenantRunner(client)(a.context, async (tx) => {
      await fileRepository.lockOrganization(tx)
      return fileRepository.requireCurrentActor(tx, a.sessionId)
    })
    const rejection = assert.rejects(pending, errorCode("FORBIDDEN"))
    await waitForActorLock(applicationName)
    await blocker.query("COMMIT")
    await rejection
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    client.release()
  }
})

test("Session在等待status期间自然到期，使用最终数据库时钟拒绝", async () => {
  const a = await actorWorkspace(),
    blocker = await owner.connect(),
    client = await runtime.connect()
  const applicationName = `actor-expiry-${randomUUID()}`
  await owner.query(
    "UPDATE session SET expires_at=clock_timestamp()+interval '250 milliseconds' WHERE id=$1",
    [a.sessionId]
  )
  try {
    await blocker.query("BEGIN")
    await blocker.query("SELECT public.require_active_organization($1)", [
      a.context.organizationId,
    ])
    await client.query("SELECT set_config('application_name',$1,false)", [
      applicationName,
    ])
    const pending = createTenantRunner(client)(a.context, async (tx) => {
      await fileRepository.lockOrganization(tx)
      return fileRepository.requireCurrentActor(tx, a.sessionId)
    })
    const rejection = assert.rejects(pending, errorCode("UNAUTHENTICATED"))
    await waitForActorLock(applicationName)
    while (
      (
        await owner.query(
          "SELECT expires_at>clock_timestamp() AS valid FROM session WHERE id=$1",
          [a.sessionId]
        )
      ).rows[0]!.valid
    )
      await new Promise((resolve) => setTimeout(resolve, 10))
    await blocker.query("COMMIT")
    await rejection
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    client.release()
  }
})

test("成功执行持Session共享锁至提交，撤销按提交后生效", async () => {
  const a = await actorWorkspace(),
    client = await runtime.connect(),
    revoker = await owner.connect()
  const applicationName = `actor-revoke-${randomUUID()}`
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let locked!: () => void
  const ready = new Promise<void>((resolve) => {
    locked = resolve
  })
  let write: Promise<void> | undefined, revoke: Promise<unknown> | undefined
  try {
    write = createTenantRunner(client)(a.context, async (tx) => {
      await fileRepository.lockOrganization(tx)
      await fileRepository.requireCurrentActor(tx, a.sessionId)
      locked()
      await gate
      await begin(tx, "create-folder", {
        parentId: a.root.id,
        name: "authorized",
      })
    })
    await ready
    await revoker.query("SELECT set_config('application_name',$1,false)", [
      applicationName,
    ])
    revoke = revoker.query(
      "UPDATE session SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [a.sessionId]
    )
    await waitForActorLock(applicationName)
    release()
    await write
    await revoke
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::integer AS total FROM file_operations WHERE organization_id=$1",
          [a.context.organizationId]
        )
      ).rows[0]!.total,
      1
    )
    await assert.rejects(
      currentActor(a.context, a.sessionId),
      errorCode("UNAUTHENTICATED")
    )
  } finally {
    release()
    await write?.catch(() => {})
    await revoke?.catch(() => {})
    client.release()
    revoker.release()
  }
})
