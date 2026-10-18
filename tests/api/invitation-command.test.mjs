import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { businessTaskRepository } from "../../packages/database/dist/repositories/business-tasks.js"
import { createTaskTenantRunner } from "../../packages/database/dist/task-tenant.js"
import {
  createTaskEnvelope,
  taskContext,
} from "../../packages/jobs/dist/contract.js"
import { createOrganizationInvitationImportTask } from "../../packages/jobs/dist/organization-invitation-import.js"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

const require = createRequire(
  new URL("../../packages/jobs/package.json", import.meta.url)
)
const ExcelJS = require("exceljs")

describe("invitation creation and durable delivery intent", () => {
  const origin = "http://localhost:3200"
  const limits = { organization: 1000, actor: 1000, ip: 1000 }
  let environment
  beforeAll(async () => {
    environment = await startTestApplication({
      origins: [origin],
      invitationLimits: limits,
    })
  })
  afterAll(async () => environment?.close())

  async function fixture() {
    const owner = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Atomic invitation", slug: randomUUID() },
    })
    return { owner, organization }
  }

  async function facts(organizationId) {
    return (
      await environment.observer.query(
        `SELECT
        (SELECT count(*)::int FROM invitation WHERE organization_id=$1) AS invitations,
        (SELECT count(*)::int FROM invitation_send_events WHERE organization_id=$1) AS quota,
        (SELECT count(*)::int FROM audit_events WHERE organization_id=$1 AND event_code='member.invited') AS audit,
        (SELECT count(*)::int FROM invitation_delivery_attempts WHERE organization_id=$1) AS deliveries`,
        [organizationId]
      )
    ).rows[0]
  }

  async function rejectDelivery(email, work) {
    const name = `test_invitation_delivery_${randomUUID().replaceAll("-", "")}`
    // 故障仅匹配本用例的随机邮箱；其他连接和正在运行的本机应用不受影响。
    await environment.migrator
      .query(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM public.invitation WHERE id=NEW.invitation_id AND email='${email}') THEN
          RAISE EXCEPTION 'TEST_DELIVERY_INTENT_REJECTED';
        END IF;
        RETURN NEW;
      END $$`)
    try {
      await environment.migrator.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON public.invitation_delivery_attempts FOR EACH ROW EXECUTE FUNCTION public.${name}()`
      )
      try {
        await work()
      } finally {
        await environment.migrator.query(
          `DROP TRIGGER ${name} ON public.invitation_delivery_attempts`
        )
      }
    } finally {
      await environment.migrator.query(`DROP FUNCTION public.${name}()`)
    }
  }

  it("commits exactly one quota reservation, creation audit and delivery intent for a native invitation", async () => {
    const f = await fixture()
    const invitation = await environment.runtime.auth.api.createInvitation({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        email: `${randomUUID()}@example.test`,
        role: "member",
      },
    })
    expect(await facts(f.organization.id)).toEqual({
      invitations: 1,
      quota: 1,
      audit: 1,
      deliveries: 1,
    })
    const attempts = await environment.observer.query(
      `SELECT d.actor_id,d.request_id,a.request_id AS audit_request_id
       FROM invitation_delivery_attempts d JOIN audit_events a ON a.resource_id=d.invitation_id
       WHERE d.invitation_id=$1 AND a.event_code='member.invited'`,
      [invitation.id]
    )
    expect(attempts.rows).toEqual([
      {
        actor_id: f.owner.user.id,
        request_id: expect.any(String),
        audit_request_id: attempts.rows[0].request_id,
      },
    ])
  })

  it("rolls back the native invitation, quota and successful audit when its delivery intent cannot be written", async () => {
    const f = await fixture()
    const email = `${randomUUID()}@example.test`
    await rejectDelivery(email, async () => {
      await expect(
        environment.runtime.auth.api.createInvitation({
          headers: f.owner.headers,
          body: { organizationId: f.organization.id, email, role: "member" },
        })
      ).rejects.toThrow("TEST_DELIVERY_INTENT_REJECTED")
    })
    expect(await facts(f.organization.id)).toEqual({
      invitations: 0,
      quota: 0,
      audit: 0,
      deliveries: 0,
    })
  })

  it("rolls back every imported invitation and leaves no report when a later row cannot persist its delivery intent", async () => {
    const f = await fixture()
    const rejectedEmail = `${randomUUID()}@example.test`
    const book = new ExcelJS.Workbook()
    book
      .addWorksheet("Invitations")
      .addRows([["email"], [`${randomUUID()}@example.test`], [rejectedEmail]])
    const input = {
      format: "xlsx",
      role: "member",
      contentBase64: Buffer.from(await book.xlsx.writeBuffer()).toString(
        "base64"
      ),
    }
    const definition = createOrganizationInvitationImportTask(limits)
    const identity = {
      organizationId: f.organization.id,
      actorId: f.owner.user.id,
      resourceId: randomUUID(),
      requestId: randomUUID(),
      locale: "en-US",
    }
    const task = taskContext(
      createTaskEnvelope([definition], {
        type: "invitations.import",
        identity,
        input: { ...input, sourceIpHash: "a".repeat(64) },
        idempotencyKey: randomUUID(),
      }),
      1
    )
    await rejectDelivery(rejectedEmail, async () => {
      await expect(
        createTaskTenantRunner(environment.runtime.pool)(
          identity,
          definition.permissions,
          async (tx) => {
            // 与任务执行同一事务建夹具，后台派发器看不到尚未提交的任务。
            await businessTaskRepository.create(tx, {
              id: identity.resourceId,
              organizationId: identity.organizationId,
              actorId: identity.actorId,
              type: "invitations.import",
              format: "xlsx",
              locale: identity.locale,
              status: "running",
              idempotencyKey: task.idempotencyKey,
              jobId: task.jobId,
              intentFingerprint: task.intentFingerprint,
              requestId: task.identity.requestId,
              input: task.input,
            })
            await definition.authorizeResource(tx, task)
            return definition.execute(tx, task)
          }
        )
      ).rejects.toMatchObject({
        cause: { message: "TEST_DELIVERY_INTENT_REJECTED" },
      })
    })
    expect(await facts(f.organization.id)).toEqual({
      invitations: 0,
      quota: 0,
      audit: 0,
      deliveries: 0,
    })
    const retained = await environment.observer.query(
      "SELECT status,result,result_content FROM business_tasks WHERE id=$1",
      [identity.resourceId]
    )
    expect(retained.rows).toEqual([])
  })
})
