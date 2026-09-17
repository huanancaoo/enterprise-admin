import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth.ts"

export const platformAssignment = pgTable("platform_assignment", {
  // 平台任职是独立事实：有行才是平台管理员，不能从组织成员或角色推导。
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  grantedAt: timestamp("granted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
