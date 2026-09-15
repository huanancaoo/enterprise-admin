import type { Preview } from "@storybook/react-vite"
import { mswLoader } from "msw-storybook-addon/csf3"
import { I18nextProvider } from "react-i18next"
import { i18n } from "../frontend/i18n"

const preview: Preview = {
  globalTypes: { locale: { toolbar: { items: ["zh-CN", "en-US", "ar"] } } },
  initialGlobals: { locale: "zh-CN" },
  loaders: [
    mswLoader(),
    async ({ globals }) => {
      await i18n.changeLanguage(globals.locale)
      document.documentElement.lang = globals.locale
      document.documentElement.dir = globals.locale === "ar" ? "rtl" : "ltr"
    },
  ],
  decorators: [
    (Story) => (
      <I18nextProvider i18n={i18n}>
        <Story />
      </I18nextProvider>
    ),
  ],
}
export default preview
