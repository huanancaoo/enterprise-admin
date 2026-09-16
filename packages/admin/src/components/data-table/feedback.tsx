import { useTranslation } from "react-i18next"
import { Button } from "@workspace/ui/components/button"
import type { DataTableStatus } from "./types"

export function DataTableFeedback({
  status,
  error,
  onRetry,
  isActionPending,
  hasData,
}: {
  status: DataTableStatus
  error?: string
  onRetry?: () => void
  isActionPending: boolean
  hasData: boolean
}) {
  const { t } = useTranslation("common")
  if (status === "forbidden") {
    return (
      <div
        role="alert"
        className="space-y-2 rounded-2xl border p-8 text-center"
      >
        <h2 className="font-semibold">{t("permissionDenied")}</h2>
        <p>{t("permissionDescription")}</p>
      </div>
    )
  }
  if (status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
        <div role="alert" className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">
            {hasData ? t("tableRefreshFailed") : t("errorTitle")}
          </p>
          <p className="text-sm wrap-anywhere">
            {error ?? t("errorDescription")}
          </p>
        </div>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            {t("retry")}
          </Button>
        )}
      </div>
    )
  }
  if (status === "loading" || status === "refreshing" || isActionPending) {
    return (
      <p
        role="status"
        className={
          status === "loading" ? "sr-only" : "text-sm text-muted-foreground"
        }
      >
        {isActionPending
          ? t("submitting")
          : status === "refreshing"
            ? t("tableRefreshing")
            : t("loading")}
      </p>
    )
  }
  return null
}
