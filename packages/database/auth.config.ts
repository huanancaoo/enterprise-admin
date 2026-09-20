import { Pool } from "pg"
import { createAuth, noopAuthEmailHooks } from "./src/auth.ts"

// CLI 只读取配置生成 Schema；此临时密钥和无连接 Pool 不用于运行服务。
export const auth = createAuth(
  new Pool(),
  "http://localhost:3000",
  "schema-generation-only-not-a-runtime-secret",
  [],
  noopAuthEmailHooks,
  {
    clientId: "schema-generation-only",
    clientSecret: "schema-generation-only",
  }
)
