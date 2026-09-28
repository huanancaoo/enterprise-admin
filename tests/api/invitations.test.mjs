import { createServer } from "node:net"
import { randomUUID } from "node:crypto"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("native invitation lifecycle and delivery", () => {
  let environment, runtime, migrator, baseURL
  const origin = "http://localhost:3200"
  const signup = () => signUpVerified(baseURL, origin, migrator)
  const post = (path, body, actor) =>
    fetch(`${baseURL}/api/auth/organization/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        cookie: actor.cookie,
      },
      body: JSON.stringify(body),
    })
  const organization = (actor) =>
    runtime.auth.api.createOrganization({
      headers: actor.headers,
      body: { name: "Invitation org", slug: randomUUID() },
    })
  beforeAll(async () => {
    environment = await startTestApplication()
    ;({ runtime, migrator, baseURL } = environment)
  })
  afterAll(() => environment?.close())

  it("creates a seven-day invitation and rejects concurrent duplicates explicitly", async () => {
    const actor = await signup()
    const org = await organization(actor)
    const email = `${randomUUID()}@example.test`
    const responses = await Promise.all(
      [0, 1].map(() =>
        post(
          "invite-member",
          {
            organizationId: org.id,
            email,
            role: "member",
          },
          actor
        )
      )
    )
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    const invitation = await responses.find((r) => r.status === 200).json()
    expect(
      new Date(invitation.expiresAt) - new Date(invitation.createdAt)
    ).toBeCloseTo(7 * 86_400_000, -3)
    expect((await responses.find((r) => r.status === 409).json()).code).toBe(
      "INVITATION_ALREADY_PENDING"
    )
  })
  it("keeps a created invitation and exposes a failed SMTP attempt to its manager", async () => {
    const actor = await signup()
    const org = await organization(actor)
    const response = await post(
      "invite-member",
      {
        organizationId: org.id,
        email: `${randomUUID()}@example.test`,
        role: "member",
      },
      actor
    )
    expect(response.status).toBe(200)
    const invitation = await response.json()
    const list = await fetch(
      `${baseURL}/api/auth/organization/list-invitations?organizationId=${org.id}`,
      { headers: actor.headers }
    )
    expect(list.status).toBe(200)
    const row = (await list.json()).find((row) => row.id === invitation.id)
    expect(row.status).toBe("pending")
    expect(row.delivery.status).toBe("failed")
    expect(row.delivery.errorCode).toBe("SMTP_CONNECTION_FAILED")
    expect(row.delivery.attemptId).toBeTruthy()
  })

  it("does not expose existence or terminal state to an unauthorized recipient or manager", async () => {
    const owner = await signup()
    const recipient = await signup()
    const other = await signup()
    const org = await organization(owner)
    const invitation = await (
      await post(
        "invite-member",
        {
          organizationId: org.id,
          email: recipient.email,
          role: "member",
        },
        owner
      )
    ).json()
    await runtime.auth.api.addMember({
      headers: owner.headers,
      body: { organizationId: org.id, userId: other.user.id, role: "member" },
    })
    for (const state of ["pending", "rejected"]) {
      if (state === "rejected")
        await post(
          "reject-invitation",
          { invitationId: invitation.id },
          recipient
        )
      if (state === "rejected")
        await migrator.query(
          "UPDATE organization_status SET status = 'SUSPENDED' WHERE organization_id = $1",
          [org.id]
        )
      const previews = await Promise.all(
        [invitation.id, randomUUID()].map((id) =>
          fetch(`${baseURL}/api/auth/organization/get-invitation?id=${id}`, {
            headers: other.headers,
          })
        )
      )
      expect(previews.map((response) => response.status)).toEqual([403, 403])
      expect(await previews[0].json()).toEqual(await previews[1].json())
      for (const path of [
        "accept-invitation",
        "reject-invitation",
        "cancel-invitation",
      ]) {
        const existing = await post(
          path,
          { invitationId: invitation.id },
          other
        )
        const missing = await post(path, { invitationId: randomUUID() }, other)
        expect(existing.status).toBe(403)
        expect(missing.status).toBe(403)
        expect(await existing.json()).toEqual(await missing.json())
      }
    }
  })

  it("preserves committed creation when recording the SMTP outcome fails", async () => {
    const owner = await signup()
    const org = await organization(owner)
    // 故障发生在 unknown 已落库且 SMTP 已尝试之后，模拟结果持久化不可用。
    await migrator.query(`CREATE FUNCTION public.fail_invitation_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status <> 'unknown' THEN RAISE EXCEPTION 'injected outcome write failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER fail_invitation_outcome BEFORE UPDATE ON invitation_delivery_attempts FOR EACH ROW EXECUTE FUNCTION public.fail_invitation_outcome();`)
    let invitation
    try {
      const response = await post(
        "invite-member",
        {
          organizationId: org.id,
          email: randomUUID() + "@example.test",
          role: "member",
        },
        owner
      )
      expect(response.status).toBe(200)
      invitation = await response.json()
    } finally {
      await migrator.query(
        "DROP TRIGGER fail_invitation_outcome ON invitation_delivery_attempts; DROP FUNCTION public.fail_invitation_outcome();"
      )
    }
    const list = await runtime.auth.api.listInvitations({
      headers: owner.headers,
      query: { organizationId: org.id },
    })
    expect(list.find((row) => row.id === invitation.id)).toMatchObject({
      status: "pending",
      delivery: { status: "unknown" },
    })
  })

  it("rejects expired invitations and member duplicates, while allowing a new invitation after expiry", async () => {
    const owner = await signup()
    const recipient = await signup()
    const org = await organization(owner)
    const body = {
      organizationId: org.id,
      email: recipient.email,
      role: "member",
    }
    const invitation = await (await post("invite-member", body, owner)).json()
    await migrator.query(
      "UPDATE invitation SET expires_at = now() - interval '1 second' WHERE id = $1",
      [invitation.id]
    )
    expect(
      (
        await post(
          "accept-invitation",
          { invitationId: invitation.id },
          recipient
        )
      ).status
    ).toBe(409)
    expect(
      (await post("invite-member", { ...body, resend: true }, owner)).status
    ).toBe(409)
    const replacement = await (await post("invite-member", body, owner)).json()
    expect(replacement.id).not.toBe(invitation.id)
    expect(
      (
        await post(
          "accept-invitation",
          { invitationId: replacement.id },
          recipient
        )
      ).status
    ).toBe(200)
    const duplicate = await post("invite-member", body, owner)
    expect(duplicate.status).toBe(409)
    expect((await duplicate.json()).code).toBe("MEMBER_ALREADY_EXISTS")
    const auditClient = await runtime.pool.connect()
    let audit
    try {
      await auditClient.query("BEGIN")
      await auditClient.query(
        "SELECT set_config('app.organization_id', $1, true)",
        [org.id]
      )
      audit = await auditClient.query(
        "SELECT event_code, resource_type FROM audit_events WHERE resource_id = $1",
        [replacement.id]
      )
    } finally {
      await auditClient.query("ROLLBACK")
      auditClient.release()
    }
    expect(audit.rows).toEqual(
      expect.arrayContaining([
        { event_code: "member.invited", resource_type: "invitation" },
        { event_code: "invitation.accepted", resource_type: "invitation" },
        {
          event_code: "invitation.delivery_failed",
          resource_type: "invitation",
        },
      ])
    )
  })

  it("rejects owner invitations and admin invitations from an admin", async () => {
    const owner = await signup()
    const admin = await signup()
    const org = await organization(owner)
    await runtime.auth.api.addMember({
      headers: owner.headers,
      body: { organizationId: org.id, userId: admin.user.id, role: "admin" },
    })
    for (const [actor, role] of [
      [owner, "owner"],
      [admin, "admin"],
    ]) {
      const response = await post(
        "invite-member",
        { organizationId: org.id, email: `${randomUUID()}@example.test`, role },
        actor
      )
      expect(response.status).toBe(403)
      expect((await response.json()).code).toBe("INVITATION_ROLE_FORBIDDEN")
    }
  })
  it("resends only an active invitation after a sixty-second cooldown without extending expiry", async () => {
    const actor = await signup()
    const org = await organization(actor)
    const email = `${randomUUID()}@example.test`
    const body = { organizationId: org.id, email, role: "member" }
    const invitation = await (await post("invite-member", body, actor)).json()
    const tooSoon = await post(
      "invite-member",
      { ...body, resend: true },
      actor
    )
    expect(tooSoon.status).toBe(429)
    expect(await tooSoon.json()).toMatchObject({
      code: "INVITATION_RESEND_COOLDOWN",
      message: "请在上次发送 60 秒后重发。",
    })
    await migrator.query(
      "UPDATE invitation_delivery_attempts SET created_at = clock_timestamp() - interval '61 seconds' WHERE invitation_id = $1",
      [invitation.id]
    )
    const resent = await post("invite-member", { ...body, resend: true }, actor)
    expect(resent.status).toBe(200)
    const result = await resent.json()
    expect(result.id).toBe(invitation.id)
    expect(result.expiresAt).toBe(invitation.expiresAt)
    await post("cancel-invitation", { invitationId: invitation.id }, actor)
    const terminal = await post(
      "invite-member",
      { ...body, resend: true },
      actor
    )
    expect(terminal.status).toBe(409)
    expect((await terminal.json()).code).toBe("INVITATION_NOT_ACTIVE")
  })

  it("allows only the verified recipient to reject an invitation in a suspended organization", async () => {
    const owner = await signup()
    const recipient = await signup()
    const other = await signup()
    const org = await organization(owner)
    const invitation = await (
      await post(
        "invite-member",
        { organizationId: org.id, email: recipient.email, role: "member" },
        owner
      )
    ).json()
    await migrator.query(
      "UPDATE organization_status SET status = 'SUSPENDED' WHERE organization_id = $1",
      [org.id]
    )
    const wrong = await post(
      "reject-invitation",
      { invitationId: invitation.id },
      other
    )
    expect(wrong.status).toBe(403)
    const rejected = await post(
      "reject-invitation",
      { invitationId: invitation.id },
      recipient
    )
    expect(rejected.status).toBe(200)
    expect((await rejected.json()).invitation.status).toBe("rejected")
    const replay = await post(
      "reject-invitation",
      { invitationId: invitation.id },
      recipient
    )
    expect(replay.status).toBe(409)
  })
  it("serializes accept and cancel, forbids terminal replay, and never re-adds a removed recipient", async () => {
    const owner = await signup()
    const recipient = await signup()
    const org = await organization(owner)
    const invitation = await (
      await post(
        "invite-member",
        { organizationId: org.id, email: recipient.email, role: "member" },
        owner
      )
    ).json()
    const responses = await Promise.all([
      post("accept-invitation", { invitationId: invitation.id }, recipient),
      post("cancel-invitation", { invitationId: invitation.id }, owner),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ])
    const list = await runtime.auth.api.listInvitations({
      headers: owner.headers,
      query: { organizationId: org.id },
    })
    const terminal = list.find((row) => row.id === invitation.id).status
    const members = await runtime.auth.api.listMembers({
      headers: owner.headers,
      query: { organizationId: org.id },
    })
    expect(
      members.members.filter((member) => member.userId === recipient.user.id)
    ).toHaveLength(terminal === "accepted" ? 1 : 0)
    // 移除是验收前提；重放结果仍只通过原生入口与成员目录读取观察。
    if (terminal === "accepted")
      await migrator.query(
        "DELETE FROM member WHERE organization_id = $1 AND user_id = $2",
        [org.id, recipient.user.id]
      )
    const replay = await post(
      "accept-invitation",
      { invitationId: invitation.id },
      recipient
    )
    expect(replay.status).toBe(409)
    const after = await runtime.auth.api.listMembers({
      headers: owner.headers,
      query: { organizationId: org.id },
    })
    expect(
      after.members.some((member) => member.userId === recipient.user.id)
    ).toBe(false)
  })

  it("rechecks the original inviter and protects the invitation directory from members", async () => {
    const owner = await signup()
    const admin = await signup()
    const recipient = await signup()
    const org = await organization(owner)
    await runtime.auth.api.addMember({
      headers: owner.headers,
      body: { organizationId: org.id, userId: admin.user.id, role: "admin" },
    })
    const invitation = await (
      await post(
        "invite-member",
        { organizationId: org.id, email: recipient.email, role: "member" },
        admin
      )
    ).json()
    await migrator.query(
      "UPDATE member SET role = 'member' WHERE organization_id = $1 AND user_id = $2",
      [org.id, admin.user.id]
    )
    const directory = await fetch(
      `${baseURL}/api/auth/organization/list-invitations?organizationId=${org.id}`,
      { headers: admin.headers }
    )
    expect(directory.status).toBe(403)
    const accepted = await post(
      "accept-invitation",
      { invitationId: invitation.id },
      recipient
    )
    expect(accepted.status).toBe(403)
    expect((await accepted.json()).code).toBe("FORBIDDEN")
  })
  it("returns native validation errors for malformed invitation input", async () => {
    const owner = await signup()
    const org = await organization(owner)
    const response = await post(
      "invite-member",
      { organizationId: org.id, role: "member" },
      owner
    )
    expect(response.status).toBe(400)
  })

  it("does not disclose invitation emails through the full organization read", async () => {
    const owner = await signup()
    const member = await signup()
    const org = await organization(owner)
    await runtime.auth.api.addMember({
      headers: owner.headers,
      body: { organizationId: org.id, userId: member.user.id, role: "member" },
    })
    await post(
      "invite-member",
      {
        organizationId: org.id,
        email: `${randomUUID()}@example.test`,
        role: "member",
      },
      owner
    )
    const response = await fetch(
      `${baseURL}/api/auth/organization/get-full-organization?organizationId=${org.id}`,
      { headers: member.headers }
    )
    expect(response.status).toBe(200)
    expect((await response.json()).invitations).toBeUndefined()
  })
  it("counts creation and resend against the organization-email hourly limit", async () => {
    const owner = await signup()
    const org = await organization(owner)
    const body = {
      organizationId: org.id,
      email: `${randomUUID()}@example.test`,
      role: "member",
    }
    const invitation = await (await post("invite-member", body, owner)).json()
    for (let count = 1; count < 5; count++) {
      await migrator.query(
        "UPDATE invitation_delivery_attempts SET created_at = clock_timestamp() - interval '61 seconds' WHERE invitation_id = $1",
        [invitation.id]
      )
      expect(
        (await post("invite-member", { ...body, resend: true }, owner)).status
      ).toBe(200)
    }
    await migrator.query(
      "UPDATE invitation_delivery_attempts SET created_at = clock_timestamp() - interval '61 seconds' WHERE invitation_id = $1",
      [invitation.id]
    )
    const limited = await post(
      "invite-member",
      { ...body, resend: true },
      owner
    )
    expect(limited.status).toBe(429)
    expect((await limited.json()).code).toBe("INVITATION_RATE_LIMITED")
  })
})

describe("SMTP ambiguity at the protocol boundary", () => {
  it("records unknown when the connection closes after DATA without a final acknowledgement", async () => {
    const sockets = new Set()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
      socket.write("220 smtp.test ESMTP\r\n")
      let buffer = ""
      let data = false
      socket.on("data", (chunk) => {
        buffer += chunk.toString()
        while (buffer.includes("\r\n")) {
          const end = buffer.indexOf("\r\n")
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          if (data) {
            if (line === ".") socket.destroy()
            continue
          }
          if (line.startsWith("EHLO")) socket.write("250 smtp.test\r\n")
          else if (line === "DATA") {
            data = true
            socket.write("354 continue\r\n")
          } else socket.write("250 OK\r\n")
        }
      })
    })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    let environment
    try {
      environment = await startTestApplication({
        smtp: { host: "127.0.0.1", port: server.address().port, secure: false },
      })
      const { baseURL, migrator, runtime } = environment
      const origin = "http://localhost:3200"
      const owner = await signUpVerified(baseURL, origin, migrator)
      const org = await runtime.auth.api.createOrganization({
        headers: owner.headers,
        body: { name: "Ambiguous SMTP", slug: randomUUID() },
      })
      const created = await runtime.auth.api.createInvitation({
        headers: owner.headers,
        body: {
          organizationId: org.id,
          email: `${randomUUID()}@example.test`,
          role: "member",
        },
      })
      const list = await runtime.auth.api.listInvitations({
        headers: owner.headers,
        query: { organizationId: org.id },
      })
      expect(list.find((row) => row.id === created.id).delivery.status).toBe(
        "unknown"
      )
    } finally {
      await environment?.close()
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    }
  })
})

describe("configured invitation send limits", () => {
  it.each(["organization", "actor", "ip"])(
    "enforces the %s limit through native HTTP",
    async (limit) => {
      const origin = "http://localhost:3200"
      const environment = await startTestApplication({
        invitationLimits: { organization: 100, actor: 50, ip: 100, [limit]: 1 },
      })
      try {
        const owner = await signUpVerified(
          environment.baseURL,
          origin,
          environment.migrator
        )
        const other =
          limit === "ip"
            ? await signUpVerified(
                environment.baseURL,
                origin,
                environment.migrator
              )
            : owner
        const createOrg = (actor) =>
          environment.runtime.auth.api.createOrganization({
            headers: actor.headers,
            body: { name: "Rate limit", slug: randomUUID() },
          })
        const firstOrg = await createOrg(owner)
        const secondOrg =
          limit === "organization" ? firstOrg : await createOrg(other)
        const invite = (actor, org, forwarded) =>
          fetch(environment.baseURL + "/api/auth/organization/invite-member", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: actor.cookie,
              origin,
              "x-forwarded-for": forwarded,
              "x-real-ip": forwarded,
            },
            body: JSON.stringify({
              organizationId: org.id,
              email: `${randomUUID()}@example.test`,
              role: "member",
            }),
          })
        expect((await invite(owner, firstOrg, "192.0.2.1")).status).toBe(200)
        const limited = await invite(other, secondOrg, "192.0.2.2")
        expect(limited.status).toBe(429)
        expect((await limited.json()).code).toBe("INVITATION_RATE_LIMITED")
      } finally {
        await environment.close()
      }
    }
  )
})
