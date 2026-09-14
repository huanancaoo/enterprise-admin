import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import globals from "globals"
import { defineConfig } from "eslint/config"
import { createBaseConfig } from "./base.js"

/** @param {string} tsconfigRootDir 使用方的配置目录。 */
export function createReactConfig(tsconfigRootDir) {
  return defineConfig([
    ...createBaseConfig(tsconfigRootDir),
    {
      files: ["**/*.{ts,tsx}"],
      extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
      languageOptions: { globals: globals.browser },
    },
  ])
}
