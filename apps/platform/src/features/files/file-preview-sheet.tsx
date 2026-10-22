import { useTranslation } from "react-i18next"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@workspace/ui/components/sheet"
import {
  FileDownloadButton,
  ProtectedFilePreview,
  type FileContentTarget,
} from "./file-content"

export function FilePreviewSheet({
  target,
  contentScopeKey,
  onClose,
  onOpenDetails,
  returnFocus,
}: {
  target: FileContentTarget | null
  contentScopeKey: string
  onClose: () => void
  onOpenDetails?: () => void
  returnFocus: () => HTMLElement | null
}) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side={locale === "ar" ? "left" : "right"}
        showCloseButton={false}
        finalFocus={returnFocus}
        className="w-full sm:max-w-3xl"
      >
        {target && (
          <>
            <SheetHeader className="pe-20">
              <SheetTitle className="[overflow-wrap:anywhere]">
                {target.file.name}
              </SheetTitle>
              <SheetDescription>
                {t("files:previewDescription")}
              </SheetDescription>
            </SheetHeader>
            <SheetClose
              render={
                <Button variant="ghost" className="absolute end-4 top-4" />
              }
            >
              {t("common:close")}
            </SheetClose>
            <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-auto px-6 pb-6">
              <div className="flex flex-wrap items-start gap-3">
                <FileDownloadButton
                  key={JSON.stringify([contentScopeKey, target.version.id])}
                  target={target}
                />
                {onOpenDetails && (
                  <Button variant="outline" onClick={onOpenDetails}>
                    {t("files:detail")}
                  </Button>
                )}
              </div>
              <ProtectedFilePreview
                target={target}
                contentScopeKey={contentScopeKey}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
