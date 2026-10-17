import {
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { platformAssignment, platformRole } from "./platform-assignment.ts"
import { platformDepartment, platformPost } from "./platform-system.ts"

// 任职、角色身份仍来自授权基座，这些表只承载系统管理资料。
export const platformEmployeeProfile = pgTable("platform_employee_profile", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => platformAssignment.userId, { onDelete: "cascade" }),
  departmentId: uuid("department_id").references(() => platformDepartment.id, {
    onDelete: "restrict",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})
export const platformEmployeePost = pgTable(
  "platform_employee_post",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => platformAssignment.userId, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => platformPost.id, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.postId] })]
)
export const platformRoleProfile = pgTable("platform_role_profile", {
  roleId: uuid("role_id")
    .primaryKey()
    .references(() => platformRole.id, { onDelete: "cascade" }),
  sort: integer("sort").default(0).notNull(),
})
