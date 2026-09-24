import { useState } from "react"
import { useTranslation } from "react-i18next"
import { authErrorMessage, type AuthClientError } from "./auth-error"

export function useAuthAction() {
  const { t } = useTranslation(["common"])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function run(action: () => Promise<{ error: AuthClientError | null }>) {
    setPending(true)
    setError(undefined)
    try {
      const result = await action()
      if (result.error) {
        setError(authErrorMessage(result.error, t("common:operationFailed")))
        return false
      }
      return true
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message.trim()
          ? caught.message
          : t("common:operationFailed")
      )
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
