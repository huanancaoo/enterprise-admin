import { betterAuth } from "better-auth"
import { drizzleAdapter } from "@better-auth/drizzle-adapter"
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
  getSessionFromCtx,
} from "better-auth/api"
import { drizzle } from "drizzle-orm/node-postgres"
import type { Pool } from "pg"
import * as schema from "./schema/auth.ts"
import { permissionStatements, projectActions } from "@workspace/permissions"
import {
  isOrganizationMember,
  organizationIdForInvitation,
  readOrganizationStatus,
  resolveOrganizationId,
} from "./organization-status.ts"

const ac = createAccessControl({
  ...defaultStatements,
  ...permissionStatements,
})

const unrestrictedOrganizationPaths = new Set([
  "/organization/list",
  "/organization/check-slug",
  "/organization/create",
  "/organization/reject-invitation",
  "/organization/get-invitation",
  "/organization/list-user-invitations",
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

async function assertActiveOrganization(pool: Pool, organizationId: string) {
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
  return betterAuth({
    baseURL,
    basePath: "/api/auth",
    secret,
    trustedOrigins,
    database: drizzleAdapter(drizzle(pool), { provider: "pg", schema }),
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
        if (unrestrictedOrganizationPaths.has(ctx.path)) return
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
        if (ctx.path === "/organization/set-active") {
          // 只有显式 null 才是清除偏好；省略字段会按当前 active 组织再写入并返回组织资料。
          if (body.organizationId === null && !body.organizationSlug) return
          const organizationId =
            (await resolveOrganizationId(pool, body)) ?? activeOrganizationId
          if (!organizationId) return
          if (!(await isOrganizationMember(pool, organizationId, userId)))
            return
          await assertActiveOrganization(pool, organizationId)
          return
        }
        if (ctx.path === "/organization/accept-invitation") {
          if (!body.invitationId) return
          const organizationId = await organizationIdForInvitation(
            pool,
            body.invitationId
          )
          if (!organizationId) return
          await assertActiveOrganization(pool, organizationId)
          return
        }
        if (ctx.path === "/organization/cancel-invitation") {
          if (!body.invitationId) return
          const organizationId = await organizationIdForInvitation(
            pool,
            body.invitationId
          )
          if (!organizationId) return
          if (!(await isOrganizationMember(pool, organizationId, userId)))
            return
          await assertActiveOrganization(pool, organizationId)
          return
        }
        const organizationId =
          (await resolveOrganizationId(pool, {
            organizationId: query.organizationId ?? body.organizationId,
            organizationSlug: query.organizationSlug ?? body.organizationSlug,
          })) ?? activeOrganizationId
        if (!organizationId) return
        if (!(await isOrganizationMember(pool, organizationId, userId))) return
        await assertActiveOrganization(pool, organizationId)
      }),
    },
    plugins: [
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
          // addMember 没有 HTTP 入口；创建组织时 owner 入组发生在 INSERT 触发器之后。
          beforeAddMember: async ({ member }) => {
            await assertActiveOrganization(pool, member.organizationId)
          },
        },
      }),
    ],
  })
}
