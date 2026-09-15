import { useState } from "react"
import { useTranslation } from "react-i18next"

export function Probe() {
  const { t } = useTranslation("probe")
  const [loaded, setLoaded] = useState(false)
  return (
    <main>
      <h1>{t("title")}</h1>
      <button
        onClick={async () => {
          const response = await fetch("/s0/probe")
          const data: { ok: boolean } = await response.json()
          setLoaded(data.ok)
        }}
      >
        {t("load")}
      </button>
      {loaded && <p role="status">{t("loaded")}</p>}
    </main>
  )
}
