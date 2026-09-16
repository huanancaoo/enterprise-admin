import { defineConfig } from "i18next-cli"

export default defineConfig({
  locales: ["zh-CN", "en-US", "ar"],
  extract: {
    input: [
      "../../apps/admin/src/**/*.{ts,tsx}",
      "../../apps/platform/src/**/*.{ts,tsx}",
      "../admin/src/**/*.{ts,tsx}",
      "../../apps/storybook/src/form-dialog-example.tsx",
    ],
    output: "src/locales/{{language}}/{{namespace}}.json",
    defaultNS: "common",
    primaryLanguage: "zh-CN",
    sort: true,
    // 服务端以稳定错误码查找文案，状态来自 Contract；两者属于有限动态键。
    preservePatterns: [
      "errors:*",
      "projects:draft",
      "projects:active",
      "projects:archived",
    ],
  },
  lint: {
    acceptedTags: "all",
    checkConcatenation: "error",
    checkPunctuationConcatenation: "error",
  },
  types: {
    input: ["src/locales/zh-CN/*.json"],
    output: "src/generated/i18next.ts",
    resourcesFile: "src/generated/resources.ts",
    enableSelector: false,
  },
})
