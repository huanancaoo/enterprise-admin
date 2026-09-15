import { randomBytes } from "node:crypto"
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
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

const ac = createAccessControl({
  ...defaultStatements,
  project: ["read", "create", "update", "delete", "export", "translate"],
})

export function createAuth(
  pool: Pool,
  baseURL: string,
  schema?: Record<string, unknown>
) {
  return betterAuth({
    baseURL,
    basePath: "/api/auth",
    secret: randomBytes(32).toString("hex"),
    database: drizzleAdapter(drizzle(pool), { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
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
    advanced: { database: { generateId: "uuid" } },
    plugins: [
      organization({
        ac,
        roles: {
          owner: ac.newRole({
            ...ownerAc.statements,
            project: [
              "read",
              "create",
              "update",
              "delete",
              "export",
              "translate",
            ],
          }),
          admin: ac.newRole({
            ...adminAc.statements,
            project: [
              "read",
              "create",
              "update",
              "delete",
              "export",
              "translate",
            ],
          }),
          member: ac.newRole({ ...memberAc.statements, project: ["read"] }),
        },
        dynamicAccessControl: { enabled: true },
      }),
    ],
  })
}
