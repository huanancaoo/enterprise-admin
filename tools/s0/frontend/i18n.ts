import { createInstance } from "i18next"
import { initReactI18next } from "react-i18next"
import zh from "./locales/zh-CN/probe.json"
import en from "./locales/en-US/probe.json"
import ar from "./locales/ar/probe.json"

export const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: "zh-CN",
  fallbackLng: "zh-CN",
  defaultNS: "probe",
  interpolation: { escapeValue: false },
  resources: {
    "zh-CN": { probe: zh },
    "en-US": { probe: en },
    ar: { probe: ar },
  },
})
