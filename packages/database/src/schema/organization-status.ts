import { sql } from "drizzle-orm"
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { organization } from "./auth.ts"

export const organizationStatus = pgTable(
  "organization_status",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["ACTIVE", "SUSPENDED"] }).notNull(),
    statusVersion: integer("status_version").notNull(),
    authorizationVersion: integer("authorization_version").notNull(),
    statusChangedAt: timestamp("status_changed_at", {
      withTimezone: true,
    }).notNull(),
    statusChangedBy: uuid("status_changed_by"),
    internalReason: text("internal_reason"),
  },
  (table) => [
    check(
      "organization_status_status_check",
      sql`${table.status} IN ('ACTIVE', 'SUSPENDED')`
    ),
    check(
      "organization_status_status_version_check",
      sql`${table.statusVersion} >= 1`
    ),
    check(
      "organization_status_authorization_version_check",
      sql`${table.authorizationVersion} >= 1`
    ),
  ]
)
