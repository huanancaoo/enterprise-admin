import {
  betterAuth,
  type BetterAuthPlugin,
  type SecondaryStorage,
} from "better-auth"
import { lastLoginMethod, organization, twoFactor } from "better-auth/plugins"
import { createAccessControl } from "better-auth/plugins/access"
import {
  defaultStatements,
  ownerAc,
  adminAc,
  memberAc,
} from "better-auth/plugins/organization/access"
import {
  APIError,
  createAuthMiddleware,
  getAuthoritativeSessionFromCtx,
  getSessionFromCtx,
} from "better-auth/api"
import { createHmac, randomUUID } from "node:crypto"
import type { Pool } from "pg"
import {
  builtInOrganizationRoleKeys,
  delegableRolePermissions,
  permissionStatements,
  projectActions,
} from "@workspace/permissions"
import {
  isOrganizationMember,
  readOrganizationStatus,
  type QueryExecutor,
} from "./organization-status.ts"
import { resolveOrganizationAccessTarget } from "./organization-access.ts"
import {
  createTransactionalAuthAdapter,
  wrapTransactionalOrganizationEndpoints,
} from "./auth-transaction.ts"
import { getAuthRequestContext } from "./auth-request-context.ts"
import { readRoleReferences } from "./role-references.ts"
import { readPlatformDefaultLocale } from "./platform-locale.ts"
import { createAuthI18n } from "./auth-i18n.ts"
import {
  assertMemberDirectoryRead,
  normalizeMemberListQuery,
  searchOrganizationMembers,
} from "./member-directory.ts"

import {
  assertInvitationRole,
  invitationError,
  assertInvitationActive,
  reserveInvitationSend,
  defaultInvitationLimits,
  type InvitationLimits,
  assertInvitationPermission,
  readInvitationPermission,
  type InvitationRecord,
  lockInvitation,
  assertInvitationRecipient,
} from "./invitation-policy.ts"

export {
  getAuthRequestContext,
  runWithAuthRequestContext,
} from "./auth-request-context.ts"

export type AuthEmailUser = {
  id: string
  email: string
  name: string
  preferredLocale?: string | null
}

export type AuthEmailHooks = {
  sendVerificationEmail: (data: {
    user: AuthEmailUser
    url: string
  }) => Promise<void>
  sendResetPassword: (data: {
    user: AuthEmailUser
    url: string
  }) => Promise<void>
  sendInvitationEmail: (data: {
    id: string
    attemptId: string
    actorId: string
    requestId: string
    email: string
    role: string
    organization: { id: string; name: string; defaultLocale?: string | null }
    invitation: { id: string }
    inviter: { user: { name: string } }
  }) => Promise<void>
}

export const noopAuthEmailHooks: AuthEmailHooks = {
  sendVerificationEmail: async () => {},
  sendResetPassword: async () => {},
  sendInvitationEmail: async () => {},
}

const ac = createAccessControl({
  ...defaultStatements,
  ...permissionStatements,
  member: [...defaultStatements.member, ...permissionStatements.member],
})

const delegatedPermissionActions: Record<string, readonly string[]> =
  delegableRolePermissions

function assertCustomRolePermissions(permission: unknown) {
  if (
    !permission ||
    typeof permission !== "object" ||
    Array.isArray(permission)
  ) {
    throw new APIError("BAD_REQUEST", {
      code: "ROLE_PERMISSION_NOT_DELEGABLE",
      message: "ROLE_PERMISSION_NOT_DELEGABLE",
    })
  }

  for (const [resource, actions] of Object.entries(permission)) {
    const allowedActions = delegatedPermissionActions[resource]
    if (
      !allowedActions ||
      !Array.isArray(actions) ||
      actions.some(
        (action) =>
          typeof action !== "string" || !allowedActions.includes(action)
      )
    ) {
      throw new APIError("BAD_REQUEST", {
        code: "ROLE_PERMISSION_NOT_DELEGABLE",
        message: "ROLE_PERMISSION_NOT_DELEGABLE",
      })
    }
  }
}

function assertPlatformRoleKeyNotReserved(role: unknown) {
  if (typeof role === "string" && role.startsWith("platform")) {
    throw new APIError("BAD_REQUEST", {
      code: "ROLE_NAME_INVALID",
      message: "ROLE_NAME_INVALID",
    })
  }
}

function assertCustomRoleDefinition(body: Record<string, unknown>) {
  const role = body.role
  if (
    typeof role !== "string" ||
    role.length < 3 ||
    role.length > 48 ||
    !/^[a-z0-9-]+$/.test(role) ||
    (builtInOrganizationRoleKeys as readonly string[]).includes(role)
  ) {
    throw new APIError("BAD_REQUEST", {
      code: "ROLE_NAME_INVALID",
      message: "ROLE_NAME_INVALID",
    })
  }

  assertPlatformRoleKeyNotReserved(role)
  assertCustomRolePermissions(body.permission)
}

function assertCustomRoleUpdate(body: Record<string, unknown>) {
  const data = body.data
  if (!data || typeof data !== "object" || Array.isArray(data)) return

  if ("roleName" in data) {
    assertPlatformRoleKeyNotReserved(data.roleName)
    throw new APIError("BAD_REQUEST", {
      code: "ROLE_KEY_IMMUTABLE",
      message: "ROLE_KEY_IMMUTABLE",
    })
  }

  if ("permission" in data) {
    assertCustomRolePermissions(data.permission)
  }
}

const memberManagementWritePaths = new Set([
  "/organization/update-member-role",
  "/organization/remove-member",
  "/organization/leave",
])

const versionedOrganizationWritePaths = new Set([
  "/organization/remove-member",
  "/organization/leave",
  "/organization/update-member-role",
  "/organization/update-role",
  "/organization/delete-role",
])

function missingOrganizationStatus(organizationId: string): never {
  console.error({
    event: "organization.status.missing",
    organizationId,
  })
  throw new APIError(503, {
    code: "AUTHORIZATION_UNAVAILABLE",
    message: "AUTHORIZATION_UNAVAILABLE",
  })
}

async function assertActiveOrganization(
  pool: QueryExecutor,
  organizationId: string
) {
  const status = await readOrganizationStatus(pool, organizationId)
  if (!status) missingOrganizationStatus(organizationId)
  if (status !== "ACTIVE") {
    throw new APIError("FORBIDDEN", {
      code: "ORGANIZATION_SUSPENDED",
      message: "ORGANIZATION_SUSPENDED",
    })
  }
}

async function assertMemberRoleManagement(
  pool: QueryExecutor,
  organizationId: string,
  previousRole: string,
  nextRole?: string
) {
  const actor = await pool.query<{ role: string }>(
    `SELECT role FROM member
     WHERE organization_id = $1
       AND user_id = current_setting('app.auth_actor_id')::uuid`,
    [organizationId]
  )
  // member:update/delete 只赋予动作权限，不包含管理 owner/admin 身份的资格。
  if (
    actor.rows[0]?.role !== "owner" &&
    ([previousRole, nextRole].includes("owner") ||
      [previousRole, nextRole].includes("admin"))
  ) {
    throw new APIError("FORBIDDEN", {
      code: "MEMBER_ROLE_MANAGEMENT_FORBIDDEN",
      message: "MEMBER_ROLE_MANAGEMENT_FORBIDDEN",
    })
  }
}

export function createAuth(
  pool: Pool,
  baseURL: string,
  secret: string,
  trustedOrigins: string[] = [],
  emailHooks: AuthEmailHooks,
  secondaryStorage: SecondaryStorage,
  trustedProxies: string[],
  github: { clientId: string; clientSecret: string },
  invitationLimits: InvitationLimits = defaultInvitationLimits
) {
  const transactionalAdapter = createTransactionalAuthAdapter(pool)
  type InvitationEmailData = Omit<
    Parameters<AuthEmailHooks["sendInvitationEmail"]>[0],
    "attemptId" | "actorId" | "requestId"
  >
  async function stageInvitationEmail(data: InvitationEmailData) {
    const attempt = await transactionalAdapter.query<{
      id: string
      actor_id: string
      request_id: string
    }>(
      "INSERT INTO invitation_delivery_attempts (invitation_id, organization_id) VALUES ($1, $2) RETURNING id, current_setting('app.auth_actor_id') AS actor_id, current_setting('app.auth_request_id') AS request_id",
      [data.id, data.organization.id]
    )
    transactionalAdapter.deferUntilCommit(async () => {
      try {
        await emailHooks.sendInvitationEmail({
          attemptId: attempt.rows[0].id,
          actorId: attempt.rows[0].actor_id,
          requestId: attempt.rows[0].request_id,
          id: data.id,
          email: data.email,
          role: data.role,
          organization: {
            id: data.organization.id,
            name: data.organization.name,
            defaultLocale:
              "defaultLocale" in data.organization
                ? (data.organization.defaultLocale as string | null | undefined)
                : undefined,
          },
          invitation: { id: data.invitation.id },
          inviter: { user: { name: data.inviter.user.name } },
        })
      } catch {
        // 邀请已提交。持久化不可用不能改写创建结果；attempt 保留已记录事实。
        console.error({
          event: "invitation.delivery.unavailable",
          requestId: attempt.rows[0].request_id,
        })
      }
    })
  }
  const organizationPlugin = wrapTransactionalOrganizationEndpoints(
    organization({
      schema: {
        organization: {
          additionalFields: {
            defaultLocale: {
              type: ["zh-CN", "en-US", "ar"],
              required: false,
              input: false,
            },
            defaultLocaleVersion: {
              type: "number",
              required: true,
              defaultValue: 1,
              input: false,
              returned: false,
            },
          },
        },
      },
      ac,
      roles: {
        owner: ac.newRole({
          ...ownerAc.statements,
          member: [...ownerAc.statements.member, "read"],
          project: [...projectActions],
          tenantSettings: ["read", "update"],
          audit: ["read"],
        }),
        admin: ac.newRole({
          ...adminAc.statements,
          member: [...adminAc.statements.member, "read"],
          project: [...projectActions],
          tenantSettings: ["read", "update"],
          audit: ["read"],
        }),
        member: ac.newRole({
          ...memberAc.statements,
          member: ["read"],
          project: ["read"],
        }),
      },
      dynamicAccessControl: { enabled: true },
      invitationExpiresIn: 60 * 60 * 24 * 7,
      requireEmailVerificationOnInvitation: true,
      sendInvitationEmail: stageInvitationEmail,
      organizationHooks: {
        beforeUpdateMemberRole: async ({ newRole, user }) => {
          if (newRole === "owner" && !user.emailVerified) {
            throw new APIError("BAD_REQUEST", {
              code: "MEMBER_EMAIL_UNVERIFIED",
              message: "MEMBER_EMAIL_UNVERIFIED",
            })
          }
        },
        beforeAddMember: async ({ member }) => {
          await transactionalAdapter.query(
            "SELECT public.require_active_organization($1)",
            [member.organizationId]
          )
          const operation = await transactionalAdapter.query<{ path: string }>(
            "SELECT current_setting('app.auth_organization_operation') AS path"
          )
          // 新组织的首位 owner 由原生创建流程初始化；既有组织必须先入组再晋升。
          if (operation.rows[0].path === "/organization/create") return
          if (member.role.split(",").includes("owner")) {
            throw new APIError("FORBIDDEN", {
              code: "MEMBER_ROLE_MANAGEMENT_FORBIDDEN",
              message: "MEMBER_ROLE_MANAGEMENT_FORBIDDEN",
            })
          }
          await assertMemberRoleManagement(
            { query: transactionalAdapter.query },
            member.organizationId,
            member.role
          )
        },
      },
    }),
    transactionalAdapter.run,
    async (context) => {
      const endpointContext = context as Parameters<
        typeof getAuthoritativeSessionFromCtx
      >[0] & {
        path?: string
        body?: {
          organizationId?: string
          memberId?: string
          memberIdOrEmail?: string
          role?: string | string[]
          email?: string
          resend?: boolean
          invitationId?: string
          roleName?: string
          roleId?: string
        }
      }
      const session = await getAuthoritativeSessionFromCtx(endpointContext)
      if (!session) throw new APIError("UNAUTHORIZED")
      const request = getAuthRequestContext()
      // 原生 HTTP 与 auth.api 都从同一 Header 读取版本；内部调用不能跳过并发检查。
      const rawVersion = endpointContext.headers?.get(
        "X-Expected-Authz-Version"
      )
      const parsedVersion = rawVersion ? Number(rawVersion) : undefined
      const expectedAuthorizationVersion =
        parsedVersion !== undefined &&
        Number.isSafeInteger(parsedVersion) &&
        parsedVersion > 0 &&
        parsedVersion <= 2_147_483_647
          ? parsedVersion
          : undefined
      if (
        endpointContext.path &&
        versionedOrganizationWritePaths.has(endpointContext.path) &&
        expectedAuthorizationVersion === undefined
      )
        throw new APIError("CONFLICT", {
          code: "AUTHORIZATION_VERSION_CONFLICT",
          message: "AUTHORIZATION_VERSION_CONFLICT",
        })
      await transactionalAdapter.query(
        `SELECT
           set_config('app.auth_actor_id', $1, true),
           set_config('app.auth_request_id', $2, true),
           set_config('app.expected_authorization_version', $3, true),
           set_config('app.auth_organization_operation', $4, true)`,
        [
          session.user.id,
          request?.requestId ?? randomUUID(),
          expectedAuthorizationVersion?.toString() ?? "",
          endpointContext.path ?? "",
        ]
      )
      if (
        endpointContext.path &&
        [
          "/organization/accept-invitation",
          "/organization/reject-invitation",
          "/organization/cancel-invitation",
        ].includes(endpointContext.path)
      ) {
        const invitation = await lockInvitation(
          { query: transactionalAdapter.query },
          endpointContext.body!.invitationId!,
          endpointContext.path !== "/organization/cancel-invitation"
        )
        if (endpointContext.path === "/organization/cancel-invitation") {
          await assertInvitationPermission(
            { query: transactionalAdapter.query },
            invitation.organization_id,
            session.user.id,
            "cancel"
          )
          const actor = await transactionalAdapter.query<{ role: string }>(
            "SELECT role FROM member WHERE organization_id = $1 AND user_id = $2",
            [invitation.organization_id, session.user.id]
          )
          if (invitation.role === "admin" && actor.rows[0]?.role !== "owner")
            invitationError("INVITATION_ROLE_FORBIDDEN", "FORBIDDEN")
          assertInvitationActive(invitation)
          await transactionalAdapter.query(
            "SELECT public.require_active_organization($1)",
            [invitation.organization_id]
          )
        } else {
          await assertInvitationRecipient(
            { query: transactionalAdapter.query },
            session.user.id,
            invitation.email
          )
          // 身份和权限先于终态判断，未授权者不能用错误码探测邀请状态。
          assertInvitationActive(invitation)
          if (endpointContext.path === "/organization/accept-invitation") {
            await transactionalAdapter.query(
              "SELECT public.require_active_organization($1)",
              [invitation.organization_id]
            )
            await assertInvitationRole(
              { query: transactionalAdapter.query },
              invitation.organization_id,
              invitation.inviter_id,
              invitation.role
            )
          }
        }
      }
      if (endpointContext.path === "/organization/invite-member") {
        const organizationId =
          endpointContext.body?.organizationId ??
          session.session.activeOrganizationId
        if (!organizationId) invitationError("ORGANIZATION_NOT_FOUND")
        if (
          !(await isOrganizationMember(
            { query: transactionalAdapter.query },
            organizationId,
            session.user.id
          ))
        )
          invitationError("FORBIDDEN", "FORBIDDEN")
        await transactionalAdapter.query(
          "SELECT public.require_active_organization($1)",
          [organizationId]
        )
        const email = endpointContext.body!.email!.toLowerCase()
        await assertInvitationRole(
          { query: transactionalAdapter.query },
          organizationId,
          session.user.id,
          endpointContext.body?.role
        )
        const member = await transactionalAdapter.query(
          `SELECT 1 FROM member m JOIN public."user" u ON u.id = m.user_id WHERE m.organization_id = $1 AND u.email = $2`,
          [organizationId, email]
        )
        if (member.rowCount)
          invitationError("MEMBER_ALREADY_EXISTS", "CONFLICT")
        const pending = await transactionalAdapter.query<InvitationRecord>(
          `SELECT *, expires_at AT TIME ZONE 'UTC' AS expires_at, created_at AT TIME ZONE 'UTC' AS created_at FROM invitation WHERE organization_id = $1 AND lower(email) = $2 AND status = 'pending' AND expires_at > clock_timestamp()`,
          [organizationId, email]
        )
        if (pending.rowCount && !endpointContext.body?.resend)
          invitationError("INVITATION_ALREADY_PENDING", "CONFLICT")
        if (endpointContext.body?.resend) {
          const invitation = pending.rows[0]
          if (!invitation) invitationError("INVITATION_NOT_ACTIVE", "CONFLICT")
          if (invitation.role !== endpointContext.body.role)
            invitationError("INVITATION_ROLE_IMMUTABLE", "CONFLICT")
          await assertInvitationRole(
            { query: transactionalAdapter.query },
            organizationId,
            invitation.inviter_id,
            invitation.role
          )
          const recent = await transactionalAdapter.query(
            "SELECT 1 FROM invitation_delivery_attempts WHERE invitation_id = $1 AND created_at > clock_timestamp() - interval '60 seconds'",
            [invitation.id]
          )
          if (recent.rowCount)
            invitationError("INVITATION_RESEND_COOLDOWN", "TOO_MANY_REQUESTS")
        }
        await reserveInvitationSend(
          { query: transactionalAdapter.query },
          {
            organizationId,
            email,
            actorId: session.user.id,
            ipHash: createHmac("sha256", secret)
              .update(request?.clientIp ?? "internal")
              .digest("hex"),
            limits: invitationLimits,
          }
        )
        if (endpointContext.body?.resend) {
          const invitation = pending.rows[0]
          const organization = await transactionalAdapter.query<{
            name: string
            default_locale: string | null
          }>("SELECT name, default_locale FROM organization WHERE id = $1", [
            organizationId,
          ])
          await stageInvitationEmail({
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            organization: {
              id: organizationId,
              name: organization.rows[0].name,
              defaultLocale: organization.rows[0].default_locale,
            },
            invitation: { id: invitation.id },
            inviter: { user: { name: session.user.name } },
          })
          await transactionalAdapter.query(
            "SELECT set_config('app.organization_id', $1, true)",
            [organizationId]
          )
          await transactionalAdapter.query(
            `INSERT INTO audit_events (organization_id, actor_id, event_code, resource_type, resource_id, request_id, tenant_visible, fields) VALUES ($1, $2, 'invitation.resent', 'invitation', $3, $4, true, '{}'::jsonb)`,
            [
              organizationId,
              session.user.id,
              invitation.id,
              request?.requestId ?? randomUUID(),
            ]
          )
          return {
            result: {
              id: invitation.id,
              email: invitation.email,
              role: invitation.role,
              status: invitation.status,
              organizationId,
              inviterId: invitation.inviter_id,
              expiresAt: invitation.expires_at,
              createdAt: invitation.created_at,
            },
          }
        }
      }
      if (
        endpointContext.path &&
        memberManagementWritePaths.has(endpointContext.path)
      ) {
        const organizationId =
          endpointContext.body?.organizationId ??
          session.session.activeOrganizationId
        if (
          !organizationId ||
          !(await isOrganizationMember(
            { query: transactionalAdapter.query },
            organizationId,
            session.user.id
          ))
        ) {
          throw new APIError("FORBIDDEN", {
            code: "MEMBER_ROLE_MANAGEMENT_FORBIDDEN",
            message: "MEMBER_ROLE_MANAGEMENT_FORBIDDEN",
          })
        }
        // 先取得组织锁，后由原生入口重读成员和权限，避免等待写锁期间身份已被撤销。
        await transactionalAdapter.query(
          "SELECT public.require_active_organization($1)",
          [organizationId]
        )
        if (endpointContext.path !== "/organization/leave") {
          const isRoleUpdate =
            endpointContext.path === "/organization/update-member-role"
          const role = endpointContext.body?.role
          if (
            isRoleUpdate &&
            (Array.isArray(role) ||
              (typeof role === "string" && role.includes(",")))
          ) {
            throw new APIError("BAD_REQUEST", {
              code: "SINGLE_ROLE_REQUIRED",
              message: "SINGLE_ROLE_REQUIRED",
            })
          }
          const target = await transactionalAdapter.query<{ role: string }>(
            `SELECT m.role FROM member m
             INNER JOIN public."user" u ON u.id = m.user_id
             WHERE m.organization_id = $1
               AND CASE WHEN $3::boolean AND strpos($2, '@') > 0
                 THEN u.email = lower($2) ELSE m.id = $2::uuid END`,
            [
              organizationId,
              isRoleUpdate
                ? endpointContext.body?.memberId
                : endpointContext.body?.memberIdOrEmail,
              !isRoleUpdate,
            ]
          )
          // 不让原生入口先读取其他组织成员的角色再报错；不存在与跨组织目标一致拒绝。
          if (!target.rows[0]) {
            throw new APIError("FORBIDDEN", {
              code: "MEMBER_ROLE_MANAGEMENT_FORBIDDEN",
              message: "MEMBER_ROLE_MANAGEMENT_FORBIDDEN",
            })
          }
          await assertMemberRoleManagement(
            { query: transactionalAdapter.query },
            organizationId,
            target.rows[0].role,
            isRoleUpdate && typeof role === "string" ? role.trim() : undefined
          )
        }
      }
      if (
        endpointContext.path &&
        [
          "/organization/create-role",
          "/organization/update-role",
          "/organization/delete-role",
        ].includes(endpointContext.path)
      ) {
        const organizationId =
          endpointContext.body?.organizationId ??
          session.session.activeOrganizationId
        if (
          !organizationId ||
          !(await isOrganizationMember(
            { query: transactionalAdapter.query },
            organizationId,
            session.user.id
          ))
        )
          throw new APIError("FORBIDDEN", {
            code: "FORBIDDEN",
            message: "FORBIDDEN",
          })
        // 先锁组织，再让原生入口重读权限；等待期间撤销的委派权限不能继续使用。
        await transactionalAdapter.query(
          "SELECT public.require_active_organization($1)",
          [organizationId]
        )
        if (endpointContext.path === "/organization/delete-role") {
          // 原生删除只检查成员引用，且没有数量；在同一事务内补齐有效邀请引用策略。
          const actor = await transactionalAdapter.query<{
            role: string
            permission: string | null
          }>(
            `SELECT m.role, r.permission FROM member m LEFT JOIN organization_role r
             ON r.organization_id = m.organization_id AND r.role = m.role
             WHERE m.organization_id = $1 AND m.user_id = $2`,
            [organizationId, session.user.id]
          )
          const member = actor.rows[0]
          if (
            !member ||
            (!["owner", "admin"].includes(member.role) &&
              !ac
                .newRole(JSON.parse(member.permission ?? "{}"))
                .authorize({ ac: ["delete"] }).success)
          )
            throw new APIError("FORBIDDEN", {
              code: "YOU_ARE_NOT_ALLOWED_TO_DELETE_A_ROLE",
              message: "YOU_ARE_NOT_ALLOWED_TO_DELETE_A_ROLE",
            })
          const version = await transactionalAdapter.query<{
            authorization_version: number
          }>(
            "SELECT authorization_version FROM organization_status WHERE organization_id = $1",
            [organizationId]
          )
          if (
            version.rows[0].authorization_version !==
            expectedAuthorizationVersion
          )
            throw new APIError("CONFLICT", {
              code: "AUTHORIZATION_VERSION_CONFLICT",
              message: "AUTHORIZATION_VERSION_CONFLICT",
            })
          const target = await transactionalAdapter.query<{ id: string }>(
            `SELECT id FROM organization_role WHERE organization_id = $1
              AND CASE WHEN $2::text IS NOT NULL THEN role = $2 ELSE id::text = $3 END`,
            [
              organizationId,
              endpointContext.body?.roleName ?? null,
              endpointContext.body?.roleId ?? null,
            ]
          )
          if (target.rows[0]) {
            const [references] = await readRoleReferences(
              { query: transactionalAdapter.query },
              [target.rows[0].id]
            )
            if (references.memberCount || references.invitationCount)
              throw new APIError("CONFLICT", {
                code: "ROLE_IN_USE",
                message: "ROLE_IN_USE",
                memberCount: references.memberCount,
                invitationCount: references.invitationCount,
              })
          }
        }
      }
      if (
        endpointContext.path === "/organization/create-role" &&
        endpointContext.body
      ) {
        assertCustomRoleDefinition(endpointContext.body)
      }
      if (
        endpointContext.path === "/organization/update-role" &&
        endpointContext.body
      ) {
        assertCustomRoleUpdate(endpointContext.body)
      }
    }
  )

  return betterAuth({
    baseURL,
    basePath: "/api/auth",
    secret,
    trustedOrigins,
    database: transactionalAdapter.adapterFactory,
    socialProviders: {
      github: {
        clientId: github.clientId,
        clientSecret: github.clientSecret,
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await emailHooks.sendResetPassword({
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            preferredLocale:
              "preferredLocale" in user
                ? (user.preferredLocale as string | null | undefined)
                : undefined,
          },
          url,
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await emailHooks.sendVerificationEmail({
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            preferredLocale:
              "preferredLocale" in user
                ? (user.preferredLocale as string | null | undefined)
                : undefined,
          },
          url,
        })
      },
    },
    user: {
      additionalFields: {
        preferredLocale: {
          type: ["zh-CN", "en-US", "ar"],
          required: false,
          input: false,
        },
        preferredLocaleVersion: {
          type: "number",
          required: true,
          defaultValue: 1,
          input: false,
          returned: false,
        },
      },
    },
    verification: {
      // 邮箱验证与密码重置令牌必须落库；Redis 只缓存。与 session 同一约束。
      storeInDatabase: true,
    },
    session: {
      // 接受邀请等组织写路径与 session 同行事务；Redis 只缓存，不取消 session 表。
      storeSessionInDatabase: true,
      additionalFields: {
        // activeOrganizationId 是工作区偏好，但仍引用同一个 UUID 组织标识。
        activeOrganizationId: {
          type: "string",
          required: false,
          input: false,
          references: {
            model: "organization",
            field: "id",
            onDelete: "set null",
          },
        },
      },
    },
    secondaryStorage,
    // 不依赖 NODE_ENV；计数必须走 secondary storage，禁止回退到进程内存。
    rateLimit: {
      enabled: true,
      storage: "secondary-storage",
    },
    advanced: {
      database: { generateId: "uuid" },
      // Better Auth 在 test 环境默认跳过 Origin 校验；保持各环境的 HTTP 安全语义一致。
      disableOriginCheck: false,
      disableCSRFCheck: false,
      // 不强制所有环境 Secure。本地 HTTP 必须能带会话 cookie；生产由 Better Auth 按 production 加 Secure。
      useSecureCookies: false,
      ipAddress: {
        // x-real-ip 优先。trustedProxies 为空时只接受单值头；非空则按官方规则从右跳过受信任跳。
        ipAddressHeaders: ["x-real-ip", "x-forwarded-for"],
        trustedProxies,
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/organization/list-roles" &&
          Array.isArray(ctx.context.returned)
        ) {
          const roles = ctx.context.returned as { id: string }[]
          const references = await readRoleReferences(
            { query: transactionalAdapter.query },
            roles.map((role) => role.id)
          )
          const byId = new Map(references.map((row) => [row.id, row]))
          return ctx.json(
            roles
              .filter((role) => byId.has(role.id))
              .map((role) => ({ ...role, ...byId.get(role.id) }))
          )
        }
        if (
          ctx.path === "/organization/get-full-organization" &&
          ctx.context.returned &&
          !(ctx.context.returned instanceof APIError)
        ) {
          const organization = { ...ctx.context.returned } as Record<
            string,
            unknown
          >
          const session = await getAuthoritativeSessionFromCtx(ctx)
          if (
            session &&
            !(await readInvitationPermission(
              { query: transactionalAdapter.query },
              organization.id as string,
              session.user.id,
              "read"
            ))
          ) {
            // 原生完整组织仍提供成员目录；邀请邮箱只投影给具有邀请管理权限的用户。
            delete organization.invitations
            return ctx.json(organization)
          }
        }
        if (
          ctx.path === "/organization/list-invitations" &&
          Array.isArray(ctx.context.returned)
        ) {
          const invitations = ctx.context.returned as { id: string }[]
          const details = await pool.query<{
            id: string
            businessStatus: string
            inviterName: string
            delivery: unknown
          }>(
            `SELECT i.id,
              CASE WHEN i.status = 'pending' AND i.expires_at <= clock_timestamp() THEN 'expired' ELSE i.status END AS "businessStatus",
              u.name AS "inviterName",
              CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object('attemptId', a.id, 'status', a.status,
                'attemptedAt', a.created_at, 'errorCode', a.error_code) END AS delivery
             FROM invitation i JOIN public."user" u ON u.id = i.inviter_id
             LEFT JOIN LATERAL (SELECT * FROM invitation_delivery_attempts WHERE invitation_id = i.id ORDER BY created_at DESC, id DESC LIMIT 1) a ON true
             WHERE i.id = ANY($1::uuid[])`,
            [invitations.map((i) => i.id)]
          )
          const byId = new Map(details.rows.map((row) => [row.id, row]))
          return ctx.json(
            invitations.map((invitation) => ({
              ...invitation,
              ...byId.get(invitation.id),
            }))
          )
        }

        if (ctx.path !== "/two-factor/verify-totp") return
        if (ctx.context.returned instanceof APIError) return
        const verifiedSession =
          ctx.context.newSession ??
          (await getSessionFromCtx(ctx, { disableCookieCache: true }))
        if (!verifiedSession) return
        // Only successful TOTP verification creates assurance, bound to the Session Better Auth actually issued.
        await pool.query(
          "SELECT public.record_platform_session_assurance($1, $2)",
          [verifiedSession.session.id, verifiedSession.user.id]
        )
      }),
      before: createAuthMiddleware(async (ctx) => {
        if (!ctx.path.startsWith("/organization/")) return
        if (ctx.path === "/organization/get-invitation") {
          const session = await getAuthoritativeSessionFromCtx(ctx)
          if (!session) throw new APIError("UNAUTHORIZED")
          const invitation = await transactionalAdapter.query<{
            email: string
          }>("SELECT email FROM invitation WHERE id::text = $1", [
            (ctx.query as { id?: string } | undefined)?.id,
          ])
          if (!invitation.rows[0])
            invitationError(
              "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
              "FORBIDDEN"
            )
          await assertInvitationRecipient(
            { query: transactionalAdapter.query },
            session.user.id,
            invitation.rows[0].email
          )
          // 原生确认页负责展示有效邀请；身份检查不泄露不存在、终态或组织状态。
          return
        }
        // 三个邀请状态动作在事务 prepare 中先授权再检查状态；拒绝允许停用组织。
        if (
          [
            "/organization/accept-invitation",
            "/organization/reject-invitation",
            "/organization/cancel-invitation",
          ].includes(ctx.path)
        )
          return
        const body = (ctx.body ?? {}) as {
          organizationId?: string | null
          organizationSlug?: string | null
          invitationId?: string
        }
        const query = (ctx.query ?? {}) as {
          organizationId?: string | null
          organizationSlug?: string | null
        }
        // hooks.before 早于 orgSessionMiddleware。先会话、再成员、再状态，与封装 API 同一顺序。
        const session = await getSessionFromCtx(ctx, {
          disableCookieCache: true,
        })
        if (!session) return
        const userId = session.user.id
        const activeOrganizationId =
          session.session.activeOrganizationId ?? undefined
        const organizationQuery = { query: transactionalAdapter.query }
        const organizationId = await resolveOrganizationAccessTarget(
          organizationQuery,
          {
            path: ctx.path,
            activeOrganizationId,
            body,
            query,
          }
        )
        if (!organizationId) return
        if (
          !(await isOrganizationMember(
            organizationQuery,
            organizationId,
            userId
          ))
        )
          return
        await assertActiveOrganization(organizationQuery, organizationId)
        if (
          ctx.path === "/organization/list-members" ||
          ctx.path === "/organization/get-full-organization"
        ) {
          await assertMemberDirectoryRead(
            organizationQuery,
            organizationId,
            userId
          )
        }
        if (ctx.path === "/organization/list-invitations") {
          await assertInvitationPermission(
            organizationQuery,
            organizationId,
            userId,
            "read"
          )
        }
        if (ctx.path !== "/organization/list-members") return
        const normalized = normalizeMemberListQuery(
          (ctx.query ?? {}) as Parameters<typeof normalizeMemberListQuery>[0]
        )
        if (normalized.q) {
          return searchOrganizationMembers(
            organizationQuery,
            organizationId,
            normalized
          )
        }
        return {
          context: {
            query: {
              organizationId,
              limit: normalized.limit,
              offset: normalized.offset,
              sortBy: normalized.sortBy,
              sortDirection: normalized.sortDirection,
              filterField: normalized.role ? "role" : undefined,
              filterOperator: normalized.role ? "eq" : undefined,
              filterValue: normalized.role,
            },
          },
        }
      }),
    },
    plugins: [
      organizationPlugin,
      twoFactor({ issuer: "Enterprise Admin" }) as BetterAuthPlugin,
      createAuthI18n(() => readPlatformDefaultLocale(pool)),
      // 登录页读 cookie；已登录会话从 user.lastLoginMethod 展示，必须写库。
      lastLoginMethod({ storeInDatabase: true }),
    ],
  })
}
