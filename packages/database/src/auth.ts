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

export { runWithAuthRequestContext } from "./auth-request-context.ts"

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
  trustedOrigins: string[] = []
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
    emailAndPassword: { enabled: true },
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
