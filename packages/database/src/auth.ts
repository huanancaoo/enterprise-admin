import { betterAuth, type SecondaryStorage } from "better-auth"
import { lastLoginMethod, organization } from "better-auth/plugins"
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
import { randomUUID } from "node:crypto"
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
import { createAuthI18n } from "./auth-i18n.ts"
import {
  assertMemberDirectoryRead,
  normalizeMemberListQuery,
  searchOrganizationMembers,
} from "./member-directory.ts"

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

function assertCustomRoleDefinition(body: Record<string, unknown>) {
  const role = body.role
  if (
    typeof role !== "string" ||
    role.length < 3 ||
    role.length > 48 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(role) ||
    (builtInOrganizationRoleKeys as readonly string[]).includes(role) ||
    role.startsWith("platform-")
  ) {
    throw new APIError("BAD_REQUEST", {
      code: "ROLE_NAME_INVALID",
      message: "ROLE_NAME_INVALID",
    })
  }

  const permission = body.permission
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
  github: { clientId: string; clientSecret: string }
) {
  const transactionalAdapter = createTransactionalAuthAdapter(pool)
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
      invitationExpiresIn: 60 * 60 * 48,
      requireEmailVerificationOnInvitation: true,
      sendInvitationEmail: async (data) => {
        await emailHooks.sendInvitationEmail({
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
      },
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
        endpointContext.path === "/organization/create-role" &&
        endpointContext.body
      ) {
        assertCustomRoleDefinition(endpointContext.body)
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
      before: createAuthMiddleware(async (ctx) => {
        if (!ctx.path.startsWith("/organization/")) return
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
      createAuthI18n(),
      // 登录页读 cookie；已登录会话从 user.lastLoginMethod 展示，必须写库。
      lastLoginMethod({ storeInDatabase: true }),
    ],
  })
}
