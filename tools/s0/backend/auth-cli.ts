import { Pool } from "pg"
import { createAuth } from "./auth.js"
import * as schema from "./auth-schema.js"

// CLI 仅从配置生成 Schema；生成动作不会连接数据库或执行迁移。
export const auth = createAuth(new Pool(), "http://127.0.0.1:3000", schema)
