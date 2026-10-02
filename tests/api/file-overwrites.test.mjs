import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createHash, randomUUID } from "node:crypto"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startFilesEnvironment } from "../setup/files-environment.mjs"

const origin = "http://localhost:3200"
const sha = (body) => createHash("sha256").update(body).digest("hex")

for (const kind of ["Local", "RustFS"])
  describe(kind + ": formal file overwrite recovery", () => {
    const resources = new AsyncDisposableStack()
    let environment
    beforeAll(async () => {
      environment = await startFilesEnvironment(kind, resources)
    })
    afterAll(() => resources.disposeAsync())
    const request = (fixture, suffix, options = {}) =>
      fetch(
        environment.filesBaseURL +
          `/api/v1/organizations/${fixture.organization.id}/files${suffix}`,
        {
          ...options,
          headers: {
            ...Object.fromEntries(fixture.actor.headers),
            ...options.headers,
          },
        }
      )
    const multipart = (input, body) => {
      const form = new FormData()
      for (const [name, value] of Object.entries(input))
        form.append(name, String(value))
      form.append(
        "file",
        new Blob([body], { type: "text/plain" }),
        "original.txt"
      )
      return form
    }
    const overwriteFields = (body, expectedRevision = 1) => ({
      operationId: randomUUID(),
      expectedRevision,
      contentSha256: sha(body),
      declaredBytes: body.length,
    })
    const overwrite = (fixture, input, body) =>
      request(fixture, `/entries/${fixture.file.entryId}/overwrite`, {
        method: "POST",
        body: multipart(input, body),
      })
    async function workspace() {
      const actor = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      const organization =
        await environment.runtime.auth.api.createOrganization({
          headers: actor.headers,
          body: { name: "真实覆盖恢复", slug: randomUUID() },
        })
      const fixture = { actor, organization }
      const response = await request(fixture, "/workspace")
      expect(response.status).toBe(200)
      const { root } = await response.json()
      const original = Buffer.from("保留原件")
      const uploaded = await request(fixture, "/uploads", {
        method: "POST",
        body: multipart(
          {
            operationId: randomUUID(),
            parentId: root.id,
            name: "原件.txt",
            contentSha256: sha(original),
            declaredBytes: original.length,
          },
          original
        ),
      })
      expect(uploaded.status).toBe(200)
      return {
        ...fixture,
        root,
        original,
        file: (await uploaded.json()).result,
      }
    }
    const receipt = async (fixture, id) => {
      const response = await request(fixture, "/operations/" + id)
      expect(response.status).toBe(200)
      return response.json()
    }
    async function content(fixture, versionId) {
      const response = await request(
        fixture,
        `/entries/${fixture.file.entryId}/versions/${versionId}/content`
      )
      expect(response.status).toBe(200)
      return Buffer.from(await response.arrayBuffer())
    }
    async function assertOriginal(fixture) {
      const entry = await request(fixture, "/entries/" + fixture.file.entryId)
      expect(entry.status).toBe(200)
      expect(await entry.json()).toMatchObject({
        revision: 1,
        operationId: null,
        currentVersion: { id: fixture.file.versionId },
      })
      expect(await content(fixture, fixture.file.versionId)).toEqual(
        fixture.original
      )
      const usage = await request(fixture, "/workspace")
      expect((await usage.json()).usage).toMatchObject({
        usedBytes: fixture.original.length,
        reservedBytes: 0,
        transientBytes: 0,
      })
    }

    test("覆盖形成新版本且原版本可精确下载，历史与当前容量均保留", async () => {
      const fixture = await workspace()
      const body = Buffer.from("新原件内容\nعقد جديد"),
        input = overwriteFields(body)
      const response = await overwrite(fixture, input, body)
      expect(response.status).toBe(200)
      const updated = await response.json()
      expect(updated).toMatchObject({
        action: "overwrite",
        phase: "completed",
        result: { entryId: fixture.file.entryId, revision: 2 },
      })
      expect(await content(fixture, fixture.file.versionId)).toEqual(
        fixture.original
      )
      expect(await content(fixture, updated.result.versionId)).toEqual(body)
      const history = await request(
        fixture,
        `/entries/${fixture.file.entryId}/versions`
      )
      expect(
        (await history.json()).items.map((version) => [
          version.id,
          version.isCurrent,
        ])
      ).toEqual([
        [updated.result.versionId, true],
        [fixture.file.versionId, false],
      ])
      const usage = await request(fixture, "/workspace")
      expect((await usage.json()).usage).toMatchObject({
        usedBytes: body.length + fixture.original.length,
        reservedBytes: 0,
        transientBytes: 0,
      })
      const replay = await overwrite(fixture, input, body)
      expect(replay.status).toBe(200)
      expect(await replay.json()).toEqual(updated)
      const wrong = await overwrite(fixture, input, Buffer.alloc(body.length))
      expect(wrong.status).toBe(409)
      expect((await wrong.json()).code).toBe("FILE_CONTENT_MISMATCH")
    })

    test("覆盖的revision或内容核对失败不改变原版本，明确新身份才能再次提交", async () => {
      const fixture = await workspace(),
        body = Buffer.from("replacement")
      const stale = overwriteFields(body, 2)
      const response = await overwrite(fixture, stale, body)
      expect(response.status).toBe(409)
      expect((await response.json()).code).toBe("VERSION_CONFLICT")
      expect(await receipt(fixture, stale.operationId)).toMatchObject({
        phase: "failed",
        committedAt: null,
        errorCode: "VERSION_CONFLICT",
      })
      const invalid = {
        ...overwriteFields(body),
        contentSha256: "0".repeat(64),
      }
      const mismatch = await overwrite(fixture, invalid, body)
      expect(mismatch.status).toBe(409)
      expect(await receipt(fixture, invalid.operationId)).toMatchObject({
        phase: "failed",
        committedAt: null,
        errorCode: "FILE_CONTENT_MISMATCH",
      })
      await assertOriginal(fixture)
      expect(
        (await overwrite(fixture, overwriteFields(body), body)).status
      ).toBe(200)
    })

    test.each(["备份核对落库", "旧源删除确认", "发布审计"])(
      "%s失败时实际旧源和版本恢复，未发布替换对象全部清理",
      async (point) => {
        const fixture = await workspace(),
          body = Buffer.from("不会发布的内容"),
          input = overwriteFields(body)
        const audit = point === "发布审计"
        await environment.migrator
          .query(`CREATE FUNCTION public.fail_upload_boundary() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
        IF ${audit ? "NEW.operation_id=TG_ARGV[0] AND NEW.event_code='file.overwritten'" : point === "备份核对落库" ? "NEW.operation_id::text=TG_ARGV[0] AND NEW.target_area='history' AND OLD.prepared_at IS NULL AND NEW.prepared_at IS NOT NULL" : "NEW.operation_id::text=TG_ARGV[0] AND NEW.target_area='history' AND OLD.source_deleted_at IS NULL AND NEW.source_deleted_at IS NOT NULL"} THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END IF;
        RETURN NEW; END; $fn$;
        CREATE TRIGGER fail_upload_boundary BEFORE ${audit ? "INSERT ON audit_events" : "UPDATE ON file_operation_objects"} FOR EACH ROW EXECUTE FUNCTION public.fail_upload_boundary('${input.operationId}');`)
        try {
          const response = await overwrite(fixture, input, body)
          expect(response.status).toBeGreaterThanOrEqual(400)
          expect(await receipt(fixture, input.operationId)).toMatchObject({
            phase: "failed",
            committedAt: null,
          })
          await assertOriginal(fixture)
          const facts = await environment.observer.query(
            "SELECT source_deletion_started_at,source_deleted_at,source_restored_at,target_deleted_at FROM file_operation_objects WHERE operation_id=$1 AND target_area='history'",
            [input.operationId]
          )
          expect(facts.rows[0].target_deleted_at).not.toBeNull()
          if (point === "备份核对落库")
            expect(facts.rows[0].source_deletion_started_at).toBeNull()
          else {
            expect(facts.rows[0].source_deletion_started_at).not.toBeNull()
            expect(facts.rows[0].source_restored_at).not.toBeNull()
          }
          if (point === "旧源删除确认")
            expect(facts.rows[0].source_deleted_at).toBeNull()
        } finally {
          await environment.migrator.query(
            `DROP TRIGGER fail_upload_boundary ON ${audit ? "audit_events" : "file_operation_objects"}; DROP FUNCTION public.fail_upload_boundary();`
          )
        }
      }
    )
  })
