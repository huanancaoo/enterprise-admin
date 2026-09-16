import type { StorybookConfig } from "@storybook/react-vite"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"

const config: StorybookConfig = {
  staticDirs: ["../public"],
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx", "../../admin/src/**/*.stories.tsx"],
  addons: ["@storybook/addon-vitest", "@storybook/addon-a11y"],
  core: { disableTelemetry: true },
  async viteFinal(config) {
    return {
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...config.resolve?.alias,
          "@": fileURLToPath(new URL("../../admin/src", import.meta.url)),
        },
      },
      plugins: [...(config.plugins ?? []), tailwindcss()],
    }
  },
}
export default config
