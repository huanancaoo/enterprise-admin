import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
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
import { permissionStatements, projectActions } from "@workspace/permissions"
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
})

const versionedOrganizationWritePaths = new Set([
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

export function createAuth(
  pool: Pool,
  baseURL: string,
  secret: string,
  trustedOrigins: string[] = [],
  emailHooks: AuthEmailHooks
) {
  const transactionalAdapter = createTransactionalAuthAdapter(pool)
  const organizationPlugin = wrapTransactionalOrganizationEndpoints(
    organization({
      schema: {
        organization: {
          additionalFields: {
            defaultLocale: {
              type: ["zh-CN", "en-US", "ar"],
              required: true,
              defaultValue: "zh-CN",
              input: false,
            },
          },
        },
      },
      ac,
      roles: {
        owner: ac.newRole({
          ...ownerAc.statements,
          project: [...projectActions],
        }),
        admin: ac.newRole({
          ...adminAc.statements,
          project: [...projectActions],
        }),
        member: ac.newRole({ ...memberAc.statements, project: ["read"] }),
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
        beforeAddMember: async ({ member }) => {
          await assertActiveOrganization(
            { query: transactionalAdapter.query },
            member.organizationId
          )
        },
      },
    }),
    transactionalAdapter.run,
    async (context) => {
      const endpointContext = context as Parameters<
        typeof getAuthoritativeSessionFromCtx
      >[0] & { path?: string }
      const session = await getAuthoritativeSessionFromCtx(endpointContext)
      if (!session) throw new APIError("UNAUTHORIZED")
      const request = getAuthRequestContext()
      if (
        endpointContext.path &&
        versionedOrganizationWritePaths.has(endpointContext.path) &&
        request?.expectedAuthorizationVersion === undefined
      )
        throw new APIError("CONFLICT", {
          code: "AUTHORIZATION_VERSION_CONFLICT",
          message: "AUTHORIZATION_VERSION_CONFLICT",
        })
      await transactionalAdapter.query(
        `SELECT
           set_config('app.auth_actor_id', $1, true),
           set_config('app.auth_request_id', $2, true),
           set_config('app.expected_authorization_version', $3, true)`,
        [
          session.user.id,
          request?.requestId ?? randomUUID(),
          request?.expectedAuthorizationVersion?.toString() ?? "",
        ]
      )
    }
  )

  return betterAuth({
    baseURL,
    basePath: "/api/auth",
    secret,
    trustedOrigins,
    database: transactionalAdapter.adapterFactory,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
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
        },
      },
    },
    session: {
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
    advanced: {
      database: { generateId: "uuid" },
      // Better Auth 在 test 环境默认跳过 Origin 校验；保持各环境的 HTTP 安全语义一致。
      disableOriginCheck: false,
      disableCSRFCheck: false,
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
      }),
    },
    plugins: [organizationPlugin],
  })
}
