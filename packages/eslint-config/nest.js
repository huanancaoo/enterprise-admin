import js from "@eslint/js"
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended"
import globals from "globals"
import { defineConfig, globalIgnores } from "eslint/config"
import tseslint from "typescript-eslint"

/** @param {string} tsconfigRootDir 必须指向 Nest 应用目录，以便类型感知规则读取应用自己的 TSConfig。 */
export function createNestConfig(tsconfigRootDir) {
  return defineConfig([
    globalIgnores(["dist", "eslint.config.mjs"]),
    {
      files: ["**/*.ts"],
      extends: [
        js.configs.recommended,
        tseslint.configs.recommendedTypeChecked,
        eslintPluginPrettierRecommended,
      ],
      languageOptions: {
        globals: {
          ...globals.node,
          ...globals.jest,
        },
        sourceType: "commonjs",
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-floating-promises": "warn",
        "@typescript-eslint/no-unsafe-argument": "warn",
        "prettier/prettier": ["error", { endOfLine: "auto" }],
      },
    },
  ])
}
