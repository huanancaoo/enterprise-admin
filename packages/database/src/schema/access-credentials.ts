import { index, pgTable, uuid } from "drizzle-orm/pg-core"
import { apikey, organization } from "./auth.ts"

// 原生 key 独占哈希、scope 与生命周期；此表只限定一次签发的组织归属。
export const accessCredentials = pgTable(
  "access_credentials",
  {
    apiKeyId: uuid("api_key_id")
      .primaryKey()
      .references(() => apikey.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("access_credentials_organization_idx").on(table.organizationId),
  ]
)
