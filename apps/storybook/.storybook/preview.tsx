import { StoryProviders } from "./providers"
import type { SupportedLocale } from "@workspace/i18n"
import "./preview.css"
import type { Preview, Decorator } from "@storybook/react-vite"
import { configureApiClient } from "@workspace/api-client"
import { mswLoader } from "msw-storybook-addon/csf3"

configureApiClient({ baseUrl: window.location.origin })

const withProviders: Decorator = (Story, context) => (
  <StoryProviders
    key={`${context.id}:${context.globals.locale}`}
    locale={context.globals.locale as SupportedLocale}
  >
    <Story />
  </StoryProviders>
)

const preview: Preview = {
  globalTypes: {
    locale: {
      toolbar: {
        icon: "globe",
        items: [
          { value: "zh-CN", title: "简体中文" },
          { value: "en-US", title: "English" },
          { value: "ar", title: "العربية" },
        ],
      },
    },
  },
  initialGlobals: { locale: "zh-CN" },
  loaders: [mswLoader()],
  decorators: [withProviders],
  parameters: { a11y: { test: "error" } },
}
export default preview
