import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { Pool } from "pg"
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers"
import { afterAll, beforeAll, describe, test } from "vitest"

const exec = promisify(execFile)
type Identity = { id: string; session: string }
type Announcement = {
  id: string
  title: string
  version: number
  status: string
  publicationId: string
  content: object
  attachments: object[]
}
type Page = { items: Announcement[]; total: number; unreadCount: number }
const document = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Announcement body" }],
    },
  ],
}

describe("平台公告完整发布与受众隔离", { concurrent: false }, () => {
  let container: StartedTestContainer | undefined
  let owner: Pool
  let runtime: Pool
  let fixture: string | undefined
  let admin: Identity
  let reader: Identity
  let tenantUser: Identity
  let organization: string
  let otherOrganization: string
  const legacyId = randomUUID()
  const taskId = randomUUID()
  let legacyAnnouncement: Announcement
  let upgrade: () => Promise<unknown>

  async function seed(name: string, platform = false): Promise<Identity> {
    const id = randomUUID()
    const session = randomUUID()
    await runtime.query(
      'INSERT INTO public."user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,true,now(),now())',
      [id, name, id + "@example.test"]
    )
    await runtime.query(
      "INSERT INTO public.session(id,user_id,token,updated_at,expires_at) VALUES($1,$2,$3,now(),now()+interval '1 day')",
      [session, id, randomBytes(24).toString("hex")]
    )
    if (platform) {
      await owner.query(
        "INSERT INTO public.platform_assignment(user_id,status,version,granted_at,granted_by,grant_reason) VALUES($1,'active',1,now(),'fixture','Announcement fixture')",
        [id]
      )
      await owner.query(
        "INSERT INTO public.platform_assignment_role(user_id,role_id) SELECT $1,id FROM public.platform_role WHERE key='platform_admin'",
        [id]
      )
    }
    return { id, session }
  }
  async function manage<T = Announcement>(
    operation: string,
    id: string | null = null,
    input: object = {},
    actor = admin,
    request: string = randomUUID()
  ): Promise<T> {
    return (
      await runtime.query<{ result: T }>(
        "SELECT public.platform_announcement_command($1,$2,$3,$4,$5::jsonb,$6) result",
        [actor.id, actor.session, operation, id, JSON.stringify(input), request]
      )
    ).rows[0].result
  }
  async function inbox<T = Page>(
    operation: string,
    id: string | null = null,
    input: object = {},
    actor = reader,
    org: string | null = null
  ): Promise<T> {
    const client = await runtime.connect()
    try {
      await client.query("BEGIN")
      if (org)
        await client.query("SELECT set_config('app.organization_id',$1,true)", [
          org,
        ])
      const result = await client.query<{ result: T }>(
        "SELECT public.platform_announcement_inbox($1,$2,$3,$4,$5,$6::jsonb,$7) result",
        [
          actor.id,
          org ? null : actor.session,
          org,
          operation,
          id,
          JSON.stringify(input),
          randomUUID(),
        ]
      )
      await client.query("COMMIT")
      return result.rows[0].result
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }
  function draft(extra: object = {}) {
    return {
      title: randomUUID(),
      type: "announcement",
      audience: "platform",
      organizationIds: [],
      content: document,
      attachments: [],
      ...extra,
    }
  }
  const publish = (
    value: Announcement,
    audience = "platform",
    organizationIds: string[] = []
  ) =>
    manage("publish", value.id, {
      expectedVersion: value.version,
      audience,
      organizationIds,
    })
  async function resource(actor = admin) {
    const id = randomUUID(),
      lease = randomUUID()
    const call = async (name: string, args: unknown[]) =>
      (
        await runtime.query(
          `SELECT public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
          args
        )
      ).rows[0].result
    await call("platform_file_begin", [
      actor.id,
      actor.session,
      id,
      "upload",
      {
        operationId: id,
        parentId: "00000000-0000-4000-8000-000000000002",
        name: `guide-${id}.pdf`,
        contentType: "application/pdf",
        declaredBytes: 2,
        contentSha256: "a".repeat(64),
      },
      randomUUID(),
      lease,
    ])
    const journal = await call("platform_file_prepare_upload", [
      actor.id,
      actor.session,
      id,
      lease,
    ])
    // 此层验证数据库授权与引用事务；真实对象字节由 Local/RustFS HTTP 测试验证。
    await call("platform_file_object_fact", [
      id,
      lease,
      journal.objects[0].id,
      "targetPrepared",
    ])
    const receipt = await call("platform_file_commit_upload", [
      actor.id,
      actor.session,
      id,
      lease,
    ])
    await call("platform_file_settle", [id, lease, null])
    return {
      fileId: receipt.result.entryId,
      versionId: receipt.result.versionId,
    }
  }
  beforeAll(async () => {
    const versions = JSON.parse(
      await readFile("../../docs/architecture/versions.json", "utf8")
    )
    const passwords = Array.from({ length: 5 }, () =>
      randomBytes(24).toString("hex")
    )
    container = await new GenericContainer(
      versions.releaseFoundation.postgresql.image
    )
      .withEnvironment({
        POSTGRES_USER: "bootstrap_admin",
        POSTGRES_DB: "enterprise_admin",
        POSTGRES_PASSWORD: passwords[0],
        APP_MIGRATOR_PASSWORD: passwords[1],
        APP_RUNTIME_PASSWORD: passwords[2],
        PLATFORM_RUNTIME_PASSWORD: passwords[3],
        PLATFORM_DEPLOYER_PASSWORD: passwords[4],
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
      .start()
    const url = (user: string, password: string) =>
      `postgresql://${user}:${password}@${container!.getHost()}:${container!.getMappedPort(5432)}/enterprise_admin`
    owner = new Pool({ connectionString: url("bootstrap_admin", passwords[0]) })
    runtime = new Pool({ connectionString: url("app_runtime", passwords[2]) })
    fixture = await mkdtemp(join(tmpdir(), "platform-announcements-db-"))
    await cp("src", join(fixture, "src"), { recursive: true })
    await cp("migrations", join(fixture, "migrations"), { recursive: true })
    await symlink(resolve("node_modules"), join(fixture, "node_modules"))
    const migrate = () =>
      exec(process.execPath, [join(fixture!, "src/migrate.ts")], {
        env: {
          PATH: process.env.PATH,
          MIGRATION_DATABASE_URL: url("app_migrator", passwords[1]),
        },
      })
    const journalPath = join(fixture, "migrations/meta/_journal.json")
    const journal = JSON.parse(await readFile(journalPath, "utf8"))
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter(
          (entry: { idx: number }) => entry.idx <= 92
        ),
      })
    )
    await migrate()
    admin = await seed("Publisher", true)
    // 用升级前的真实固定函数留下公告与任务资源，随后执行完整迁移链。
    for (const [id, purpose] of [
      [legacyId, "announcement"],
      [taskId, "task-input"],
    ])
      await runtime.query(
        "SELECT public.create_platform_resource($1,$2,$3,$4,'原有附件.pdf','application/pdf',2,$5,$6)",
        [admin.id, admin.session, id, purpose, "a".repeat(64), randomUUID()]
      )
    legacyAnnouncement = await publish(
      await manage(
        "create",
        null,
        draft({ attachments: [{ fileId: legacyId, versionId: legacyId }] })
      )
    )
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter(
          (entry: { idx: number }) => entry.idx <= 106
        ),
      })
    )
    await migrate()
    upgrade = async () => {
      await writeFile(journalPath, JSON.stringify(journal))
      return migrate()
    }
    reader = await seed("Platform reader", true)
    tenantUser = await seed("Tenant reader")
    organization = randomUUID()
    otherOrganization = randomUUID()
    for (const id of [organization, otherOrganization]) {
      await owner.query(
        "INSERT INTO public.organization(id,name,slug,created_at) VALUES($1,'Target',$2,now())",
        [id, randomUUID()]
      )
      await owner.query(
        "INSERT INTO public.member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,'owner',now())",
        [randomUUID(), id, tenantUser.id]
      )
      await owner.query(
        "INSERT INTO public.member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,'owner',now())",
        [randomUUID(), id, admin.id]
      )
    }
  })
  afterAll(async () => {
    await Promise.all([owner?.end(), runtime?.end()])
    await container?.stop()
    if (fixture) await rm(fixture, { recursive: true, force: true })
  })

  test("跨归属升级拒绝半完成的旧迁入，并回滚计划与迁移账本", async () => {
    const operation = (
      await owner.query(
        "SELECT * FROM public.platform_file_operations WHERE entry_id=$1",
        [legacyId]
      )
    ).rows[0]
    const ledger = await owner.query(
      "SELECT count(*)::int n FROM drizzle.__drizzle_migrations"
    )
    await owner.query(
      "UPDATE public.platform_file_operations SET lease_expires_at=now()+interval '90 seconds' WHERE id=$1",
      [operation.id]
    )
    await assert.rejects(upgrade, /PLATFORM_FILE_IMPORTS_MUST_SETTLE/)
    await owner.query(
      "UPDATE public.platform_file_operations SET lease_expires_at=$2 WHERE id=$1",
      [operation.id, operation.lease_expires_at]
    )
    await owner.query(
      "UPDATE public.platform_file_operations SET objects=jsonb_set(objects,'{2,targetPrepared}','true') WHERE id=$1",
      [operation.id]
    )
    await assert.rejects(upgrade, /PLATFORM_FILE_IMPORTS_MUST_SETTLE/)
    const after = (
      await owner.query(
        "SELECT objects FROM public.platform_file_operations WHERE id=$1",
        [operation.id]
      )
    ).rows[0]
    assert.equal(after.objects[2].targetPrepared, true)
    assert.equal(after.objects[2].sourceOwner, undefined)
    assert.deepEqual(
      (
        await owner.query(
          "SELECT count(*)::int n FROM drizzle.__drizzle_migrations"
        )
      ).rows,
      ledger.rows
    )

    await owner.query(
      "UPDATE public.platform_file_operations SET objects=$2 WHERE id=$1",
      [operation.id, JSON.stringify(operation.objects)]
    )
    // 一份已完成、另一份尚未开始同样不能跳过已在旧归属落地的文件。
    const completed = randomUUID()
    await owner.query(
      `INSERT INTO public.platform_file_operations(id,actor_id,action,request_id,input,phase,entry_id,objects,plans,committed_at,completed_at,result,lease_id,lease_expires_at)
      SELECT $1,actor_id,action,request_id,input,'completed',entry_id,objects,plans,committed_at,now(),result,lease_id,lease_expires_at
      FROM public.platform_file_operations WHERE id=$2`,
      [completed, operation.id]
    )
    await assert.rejects(upgrade, /PLATFORM_FILE_IMPORTS_MUST_SETTLE/)
    await owner.query(
      "DELETE FROM public.platform_file_operations WHERE id=$1",
      [completed]
    )
    await upgrade()
    await upgrade()
  })

  test("旧公告文件升级保留身份、引用和迁入计划，任务资源继续独立", async () => {
    const entry = (
      await owner.query(
        "SELECT id,name,current_version_id FROM public.platform_file_entries WHERE id=$1",
        [legacyId]
      )
    ).rows[0]
    assert.deepEqual(entry, {
      id: legacyId,
      name: "原有附件.pdf",
      current_version_id: legacyId,
    })
    const version = (
      await owner.query(
        "SELECT file_id,bytes,sha256,storage_path FROM public.platform_file_versions WHERE id=$1",
        [legacyId]
      )
    ).rows[0]
    assert.equal(version.file_id, legacyId)
    assert.equal(Number(version.bytes), 2)
    assert.equal(version.sha256, "a".repeat(64))
    assert.deepEqual(version.storage_path, [
      "历史公告资源",
      legacyId,
      "原有附件.pdf",
    ])
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int n FROM public.platform_file_references WHERE announcement_id=$1 AND file_id=$2 AND version_id=$2",
          [legacyAnnouncement.id, legacyId]
        )
      ).rows[0].n,
      1
    )
    const operations = (
      await owner.query(
        "SELECT id,lease_id,phase,objects FROM public.platform_file_operations WHERE entry_id=$1",
        [legacyId]
      )
    ).rows
    assert.equal(operations.length, 1)
    assert.equal(operations[0].phase, "committed")
    assert.deepEqual(operations[0].objects[2].sourcePath, [legacyId])
    assert.deepEqual(operations[0].objects[2].targetPath, version.storage_path)
    assert.deepEqual(
      (
        await owner.query(
          "SELECT id,purpose FROM public.platform_resources ORDER BY id"
        )
      ).rows,
      [{ id: taskId, purpose: "task-input" }]
    )
    // 迁入清理完成后才允许媒体访问；对象复制和校验由 HTTP/本机验收覆盖。
    for (const object of operations[0].objects)
      await runtime.query(
        "SELECT public.platform_file_object_fact($1,$2,$3,'targetPrepared')",
        [operations[0].id, operations[0].lease_id, object.id]
      )
    await runtime.query(
      "SELECT public.platform_file_object_fact($1,$2,$3,'sourceDeleted')",
      [operations[0].id, operations[0].lease_id, operations[0].objects[2].id]
    )
    await runtime.query("SELECT public.platform_file_settle($1,$2,NULL)", [
      operations[0].id,
      operations[0].lease_id,
    ])
    const media = await inbox<{ resource: { id: string; versionId: string } }>(
      "media",
      legacyId,
      { versionId: legacyId }
    )
    assert.equal(media.resource.id, legacyId)
    assert.equal(media.resource.versionId, legacyId)
    await assert.rejects(
      inbox(
        "media",
        legacyId,
        { versionId: legacyId },
        tenantUser,
        otherOrganization
      ),
      /NOT_FOUND/
    )
  })
  test("runtime 无平台公告表CRUD与私有投影函数权限，表强制RLS", async () => {
    for (const table of [
      "platform_announcements",
      "platform_announcement_publications",
      "platform_announcement_reads",
      "platform_file_references",
      "platform_file_entries",
      "platform_file_versions",
      "platform_file_operations",
      "platform_file_policy",
    ]) {
      assert.equal(
        (
          await owner.query(
            "SELECT has_table_privilege('app_runtime',$1,'SELECT,INSERT,UPDATE,DELETE') allowed",
            [table]
          )
        ).rows[0].allowed,
        false
      )
      assert.deepEqual(
        (
          await owner.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
            [table]
          )
        ).rows[0],
        { relrowsecurity: true, relforcerowsecurity: true }
      )
    }
  })
  test("草稿不进入收件箱，发布后内部员工可读并记录当前批次", async () => {
    const created = await manage("create", null, draft())
    assert.equal(
      (await inbox("list")).items.some((x) => x.id === created.id),
      false
    )
    const published = await publish(created)
    const viewed = await inbox<Announcement>("get", created.id)
    assert.equal(viewed.publicationId, published.publicationId)
    assert.equal("organizationIds" in viewed, false)
    const first = await inbox<{ publicationId: string; readAt: string }>(
      "read",
      created.id,
      { publicationId: published.publicationId }
    )
    const second = await inbox<{ publicationId: string; readAt: string }>(
      "read",
      created.id,
      { publicationId: published.publicationId }
    )
    assert.deepEqual(second, first)
    assert.equal((await manage<Page>("readers", created.id)).total, 1)
  })
  test("目标组织之外无法查看正文或枚举公告", async () => {
    const published = await publish(
      await manage("create", null, draft()),
      "organizations",
      [organization]
    )
    assert.equal(
      (await inbox("list", null, {}, tenantUser, organization)).items.some(
        (x) => x.id === published.id
      ),
      true
    )
    assert.equal(
      (await inbox("list", null, {}, tenantUser, otherOrganization)).items.some(
        (x) => x.id === published.id
      ),
      false
    )
    await assert.rejects(
      inbox("get", published.id, {}, tenantUser, otherOrganization),
      /NOT_FOUND/
    )
    await assert.rejects(inbox("get", published.id), /NOT_FOUND/)
  })
  test("全体租户公告对当前成员可见，不向平台内部收件箱混入", async () => {
    const published = await publish(
      await manage("create", null, draft()),
      "allTenants"
    )
    assert.equal(
      (await inbox("list", null, {}, tenantUser, otherOrganization)).items.some(
        (x) => x.id === published.id
      ),
      true
    )
    assert.equal(
      (await inbox("list")).items.some((x) => x.id === published.id),
      false
    )
  })
  test("发布正文不可编辑，撤回后不可读，重发产生独立未读批次", async () => {
    const input = draft()
    const published = await publish(await manage("create", null, input))
    await inbox("read", published.id, {
      publicationId: published.publicationId,
    })
    await assert.rejects(
      manage("update", published.id, {
        ...input,
        expectedVersion: published.version,
      }),
      /ANNOUNCEMENT_STATE_CONFLICT/
    )
    const withdrawn = await manage("withdraw", published.id, {
      expectedVersion: published.version,
    })
    await assert.rejects(inbox("get", published.id), /NOT_FOUND/)
    const updated = await manage("update", published.id, {
      ...input,
      title: "Revised",
      expectedVersion: withdrawn.version,
    })
    const republished = await publish(updated)
    assert.notEqual(republished.publicationId, published.publicationId)
    assert.equal(
      (await inbox<Announcement & { unread: boolean }>("get", published.id))
        .unread,
      true
    )
    await assert.rejects(
      inbox("read", published.id, { publicationId: published.publicationId }),
      /VERSION_CONFLICT/
    )
  })
  test("素材绑定后只由可见公告授权，撤回和离组均拒绝获取", async () => {
    const file = await resource()
    const published = await publish(
      await manage("create", null, draft({ attachments: [file] })),
      "organizations",
      [organization]
    )
    await inbox(
      "media",
      file.fileId,
      { versionId: file.versionId },
      tenantUser,
      organization
    )
    await assert.rejects(
      inbox(
        "media",
        file.fileId,
        { versionId: file.versionId },
        tenantUser,
        otherOrganization
      ),
      /NOT_FOUND/
    )
    await owner.query(
      "DELETE FROM public.member WHERE organization_id=$1 AND user_id=$2",
      [organization, tenantUser.id]
    )
    await assert.rejects(
      inbox(
        "media",
        file.fileId,
        { versionId: file.versionId },
        tenantUser,
        organization
      ),
      /FORBIDDEN/
    )
    await manage("withdraw", published.id, {
      expectedVersion: published.version,
    })
    await assert.rejects(
      inbox("media", file.fileId, { versionId: file.versionId }),
      /NOT_FOUND/
    )
  })
  test("有读取权限的员工可复用他人上传的文件版本", async () => {
    const foreign = await resource(reader)
    const first = await manage(
      "create",
      null,
      draft({ attachments: [foreign] })
    )
    const second = await manage(
      "create",
      null,
      draft({ attachments: [foreign] })
    )
    for (const item of [first, second])
      assert.deepEqual(
        item.attachments.map((value) => {
          const ref = value as { fileId: string; versionId: string }
          return { fileId: ref.fileId, versionId: ref.versionId }
        }),
        [foreign]
      )
  })
  test("同一固定版本可并发被两个公告引用", async () => {
    const file = await resource()
    const results = await Promise.allSettled([
      manage("create", null, draft({ attachments: [file] })),
      manage("create", null, draft({ attachments: [file] })),
    ])
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 2)
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int count FROM public.platform_file_references WHERE file_id=$1 AND version_id=$2",
          [file.fileId, file.versionId]
        )
      ).rows[0].count,
      2
    )
  })
  test("审计失败回滚公告写入，操作日志批准目录含公告和任务事实", async () => {
    await owner.query(
      "ALTER TABLE public.audit_events ADD CONSTRAINT announcement_audit_failure CHECK(request_id<>'announcement-failure')"
    )
    const input = draft()
    await assert.rejects(
      manage("create", null, input, admin, "announcement-failure"),
      /AUDIT_UNAVAILABLE/
    )
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int count FROM public.platform_announcements WHERE title=$1",
          [input.title]
        )
      ).rows[0].count,
      0
    )
    await owner.query(
      "ALTER TABLE public.audit_events DROP CONSTRAINT announcement_audit_failure"
    )
    const codes = (
      await owner.query(
        "SELECT public.platform_audit_event_codes('platform') codes"
      )
    ).rows[0].codes as string[]
    for (const code of [
      "platform.announcement_publish",
      "platform.resource_created",
      "platform.task_completed",
    ])
      assert.equal(codes.includes(code), true)
  })
})
