import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./backend/auth-schema.ts",
  out: "./migrations",
})
