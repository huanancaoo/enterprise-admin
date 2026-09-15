import js from "@eslint/js"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

/** @param {string} tsconfigRootDir 使用方的配置目录，而非共享包目录。 */
export function createBaseConfig(tsconfigRootDir) {
  return defineConfig([
    globalIgnores(["dist"]),
    {
      files: ["**/*.{ts,tsx}"],
      extends: [js.configs.recommended, tseslint.configs.recommended],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: { "@typescript-eslint/no-deprecated": "error" },
    },
  ])
}
