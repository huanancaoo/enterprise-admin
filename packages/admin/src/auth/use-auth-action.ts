import { useTranslation } from "react-i18next"
import { useMutation } from "@tanstack/react-query"

export function useAuthAction() {
  const { t } = useTranslation("common")
  const mutation = useMutation({
    mutationFn: async (
      action: () => Promise<{ error: { message?: string } | null }>
    ) => {
      const result = await action()
      if (result.error)
        throw new Error(result.error.message || t("operationFailed"))
    },
    retry: false,
  })

  async function run(
    action: () => Promise<{ error: { message?: string } | null }>
  ) {
    try {
      await mutation.mutateAsync(action)
      return true
    } catch {
      return false
    }
  }

  return {
    pending: mutation.isPending,
    error: mutation.error?.message,
    run,
    reset: mutation.reset,
  }
}
