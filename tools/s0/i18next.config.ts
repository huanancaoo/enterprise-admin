import { defineConfig } from "i18next-cli"

export default defineConfig({
  locales: ["zh-CN", "en-US", "ar"],
  extract: {
    input: ["frontend/Probe.tsx"],
    output: "frontend/locales/{{language}}/{{namespace}}.json",
    defaultNS: "probe",
    primaryLanguage: "zh-CN",
  },
  types: {
    input: ["frontend/locales/zh-CN/*.json"],
    output: "frontend/generated/i18next.d.ts",
    resourcesFile: "frontend/generated/resources.d.ts",
  },
})
