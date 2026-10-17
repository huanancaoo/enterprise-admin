import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  index,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core"
import { session, user } from "./auth.ts"

export const platformAssignment = pgTable("platform_assignment", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["active", "suspended", "revoked"],
  }).notNull(),
  version: integer("version").default(1).notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
  grantedBy: text("granted_by").notNull(),
  grantReason: text("grant_reason").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),
  revokeReason: text("revoke_reason"),
})

export const platformSessionAssurance = pgTable("platform_session_assurance", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => session.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  method: text("method", { enum: ["totp"] }).notNull(),
})

export const platformAssignmentAudit = pgTable(
  "platform_assignment_audit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    action: text("action", { enum: ["grant", "revoke"] }).notNull(),
    previousRole: text("previous_role"),
    nextRole: text("next_role"),
    result: text("result", { enum: ["changed", "no_change"] }).notNull(),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("platform_assignment_audit_created_id_idx").on(
      table.createdAt,
      table.id
    ),
  ]
)

export const platformRole = pgTable("platform_role", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  builtIn: boolean("built_in").default(false).notNull(),
  status: text("status", { enum: ["active", "suspended"] })
    .default("active")
    .notNull(),
  permissions: text("permissions").array().default([]).notNull(),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const platformAssignmentRole = pgTable(
  "platform_assignment_role",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => platformAssignment.userId, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => platformRole.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })]
)

// 密码失败锁属于全局账号，与任职、Session 和原生 MFA 锁分别建模。
export const passwordLoginLock = pgTable("password_login_lock", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  failureTimes: timestamp("failure_times", { withTimezone: true })
    .array()
    .default([])
    .notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
})
