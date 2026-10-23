import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createHash, randomUUID } from "node:crypto"
import { startFilesEnvironment } from "../setup/files-environment.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"

describe.each(["Local", "RustFS"])("平台文件覆盖恢复 - %s", (kind) => {
  const resources = new AsyncDisposableStack()
  const origin = "http://localhost:3200"
  let environment

  beforeAll(async () => {
    environment = await startFilesEnvironment(kind, resources)
  })
  afterAll(() => resources.disposeAsync())

  test.each(["备份登记", "旧源删除确认", "发布提交"])(
    "覆盖%s失败后仍可读取原版本且容量完成结算",
    async (point) => {
      const operator = await platformOperator(environment, origin)
      const base = environment.filesBaseURL + "/api/v1/platform/files"
      const read = async (path) => {
        const response = await fetch(base + path, { headers: operator.headers })
        expect(response.status, await response.clone().text()).toBe(200)
        return response.json()
      }
      const workspace = await read("/workspace")
      const send = (path, fields, text) => {
        const bytes = Buffer.from(text)
        const form = new FormData()
        for (const [key, value] of Object.entries({
          ...fields,
          declaredBytes: bytes.length,
          contentSha256: createHash("sha256").update(bytes).digest("hex"),
        }))
          form.set(key, String(value))
        form.set(
          "file",
          new Blob([bytes], { type: "text/plain" }),
          "原版本.txt"
        )
        return fetch(base + path, {
          method: "POST",
          headers: operator.headers,
          body: form,
        })
      }
      const original = "覆盖中断仍保留的原版本"
      const uploaded = await send(
        "/uploads",
        {
          operationId: randomUUID(),
          parentId: workspace.root.id,
          name: `覆盖恢复-${randomUUID()}.txt`,
        },
        original
      )
      expect(uploaded.status, await uploaded.clone().text()).toBe(200)
      const file = (await uploaded.json()).result
      const operationId = randomUUID()
      const changed =
        point === "发布提交"
          ? "OLD.committed_at IS NULL AND NEW.committed_at IS NOT NULL"
          : point === "备份登记"
            ? "OLD.objects->1->>'targetPrepared'='false' AND NEW.objects->1->>'targetPrepared'='true'"
            : "OLD.objects->1->>'sourceDeleted'='false' AND NEW.objects->1->>'sourceDeleted'='true'"
      // 从正式覆盖入口触发持久事实写入故障，验证物理副作用之后的可观察恢复结果。
      await environment.migrator.query(`
        CREATE FUNCTION public.fail_platform_overwrite_fact() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN
          IF NEW.id::text=TG_ARGV[0] AND (${changed}) THEN RAISE EXCEPTION 'FILE_STORAGE_UNAVAILABLE'; END IF;
          RETURN NEW;
        END; $fn$;
        CREATE TRIGGER fail_platform_overwrite_fact BEFORE UPDATE ON public.platform_file_operations
        FOR EACH ROW EXECUTE FUNCTION public.fail_platform_overwrite_fact('${operationId}');
      `)
      try {
        const overwritten = await send(
          `/entries/${file.entryId}/versions`,
          {
            operationId,
            expectedRevision: file.revision,
          },
          "尚未发布的新内容"
        )
        expect(overwritten.status).toBeGreaterThanOrEqual(400)
        expect(await read(`/operations/${operationId}`)).toMatchObject({
          phase: "failed",
          committedAt: null,
          errorCode: "FILE_STORAGE_UNAVAILABLE",
        })
        expect(await read(`/entries/${file.entryId}`)).toMatchObject({
          revision: file.revision,
          currentVersion: { id: file.versionId },
        })
        const versions = await read(`/entries/${file.entryId}/versions`)
        expect(versions.items).toHaveLength(1)
        const content = await fetch(
          `${base}/entries/${file.entryId}/versions/${file.versionId}/content`,
          {
            headers: operator.headers,
          }
        )
        expect(content.status).toBe(200)
        expect(await content.text()).toBe(original)
        expect((await read("/workspace")).usage).toMatchObject({
          usedBytes: workspace.usage.usedBytes + Buffer.byteLength(original),
          reservedBytes: 0,
          transientBytes: 0,
        })
      } finally {
        await environment.migrator.query(`
          DROP TRIGGER fail_platform_overwrite_fact ON public.platform_file_operations;
          DROP FUNCTION public.fail_platform_overwrite_fact();
        `)
      }
    }
  )
})
