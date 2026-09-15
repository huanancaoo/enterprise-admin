import type { StorybookConfig } from "@storybook/react-vite"

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../frontend/*.stories.tsx"],
  addons: [
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "msw-storybook-addon",
  ],
  staticDirs: ["../public"],
  core: { disableTelemetry: true },
}
export default config
