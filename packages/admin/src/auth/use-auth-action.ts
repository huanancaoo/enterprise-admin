import { useState } from "react"
import { useTranslation } from "react-i18next"

export function useAuthAction() {
  const { t } = useTranslation("common")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function run(
    action: () => Promise<{ error: { message?: string } | null }>
  ) {
    setPending(true)
    setError(undefined)
    try {
      const result = await action()
      if (result.error) {
        setError(result.error.message || t("operationFailed"))
        return false
      }
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("operationFailed"))
      return false
    } finally {
      setPending(false)
    }
  }

  return {
    pending,
    error,
    run,
    reset: () => setError(undefined),
  }
}
