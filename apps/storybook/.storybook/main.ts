import type { StorybookConfig } from "@storybook/react-vite"
import tailwindcss from "@tailwindcss/vite"

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-vitest", "@storybook/addon-a11y"],
  core: { disableTelemetry: true },
  async viteFinal(config) {
    return { ...config, plugins: [...(config.plugins ?? []), tailwindcss()] }
  },
}
export default config
