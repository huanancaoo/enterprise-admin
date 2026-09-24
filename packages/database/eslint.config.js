import { createBaseConfig } from "@workspace/eslint-config/base"
import { defineConfig } from "eslint/config"

export default defineConfig([
  ...createBaseConfig(import.meta.dirname),
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // 根入口会启动 i18next；认证 adapter 只读协商与错误词条。
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@workspace/i18n",
              message:
                "Import @workspace/i18n/locale or @workspace/i18n/catalog.",
            },
            {
              name: "@workspace/i18n/react",
              message: "Database must not import the UI i18n runtime.",
            },
          ],
        },
      ],
    },
  },
])
