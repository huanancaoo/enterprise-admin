import { useMutation } from "@tanstack/react-query"

export function useAuthAction() {
  const mutation = useMutation({
    mutationFn: async (
      action: () => Promise<{ error: { message?: string } | null }>
    ) => {
      const result = await action()
      if (result.error)
        throw new Error(result.error.message || "操作未成功，请重试。")
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
