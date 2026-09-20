import { defineConfig, globalIgnores } from "eslint/config"
import { createBaseConfig } from "@workspace/eslint-config/base"

export default defineConfig([
  ...createBaseConfig(import.meta.dirname),
  globalIgnores([".next/**", ".source/**", "out/**", "next-env.d.ts"]),
])
