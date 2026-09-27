import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core"
import { session, user } from "./auth.ts"

export const platformAssignment = pgTable("platform_assignment", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["platform_admin", "platform_auditor"],
  }).notNull(),
  status: text("status", { enum: ["active", "revoked"] }).notNull(),
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

export const platformAssignmentAudit = pgTable("platform_assignment_audit", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  action: text("action", { enum: ["grant", "revoke"] }).notNull(),
  previousRole: text("previous_role", {
    enum: ["platform_admin", "platform_auditor"],
  }),
  nextRole: text("next_role", { enum: ["platform_admin", "platform_auditor"] }),
  result: text("result", { enum: ["changed", "no_change"] }).notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
})
