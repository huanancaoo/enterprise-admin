import { useTranslation } from "react-i18next"
import type { FileEntryResponse } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { useFilePathActions } from "./path-context"
import { useFileUploadActions } from "./upload-context"
import type { FilePathAction } from "./use-file-path-operations"

export function FileEntryActions({
  entry,
  canOverwrite = false,
}: {
  entry: FileEntryResponse
  canOverwrite?: boolean
}) {
  const { t } = useTranslation("files")
  const paths = useFilePathActions()
  const uploads = useFileUploadActions()
  const labels = {
    rename: t("renameEntry"),
    move: t("moveEntry"),
    trash: t("trashEntry"),
    restore: t("restoreEntry"),
    purge: t("purgeEntry"),
  }
  const actions: FilePathAction[] =
    entry.state === "active"
      ? ["rename", "move", "trash"]
      : ["restore", "purge"]
  return (
    <div className="flex flex-wrap gap-2">
      {canOverwrite && entry.kind === "file" && entry.state === "active" && (
        <Button
          id={`${uploads.uploadTriggerId}-overwrite`}
          variant="outline"
          disabled={entry.operationId !== null}
          onClick={() => uploads.onOverwrite(entry)}
        >
          {t("overwriteFile")}
        </Button>
      )}
      {actions
        .filter((action) => paths.canShow(entry, action))
        .map((action) => (
          <Button
            key={action}
            id={`${paths.pathTriggerId}-${entry.id}-${action}`}
            variant="outline"
            // 操作占用只禁用已授权入口，保留 Dialog 完成时应返回的同一个触发节点。
            disabled={!paths.canPerform(entry, action)}
            onClick={() => paths.onAction(entry, action)}
          >
            {labels[action]}
          </Button>
        ))}
    </div>
  )
}
