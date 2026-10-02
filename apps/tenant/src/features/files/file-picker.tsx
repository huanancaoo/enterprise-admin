import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  FileVersionReferenceSchema,
  type FileResponse,
  type FileVersionReference,
  type FolderResponse,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { FileBrowser, type FileBrowserProps } from "./file-browser"

type PickerBrowserProps = Omit<
  FileBrowserProps,
  "onOpenFile" | "canOpenFile" | "renderSelectionActions" | "actions"
>

type FilePickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  browser: PickerBrowserProps
  allowedContentTypes?: readonly string[]
  uploadControl?: ReactNode
  onPick: (
    reference: FileVersionReference,
    signal: AbortSignal
  ) => Promise<void>
  getErrorMessage: (error: unknown) => string
}

export function FilePickerDialog({
  open,
  onOpenChange,
  ...props
}: FilePickerProps) {
  return open ? (
    <FilePickerContent
      key={props.browser.contentScopeKey}
      {...props}
      onOpenChange={onOpenChange}
    />
  ) : null
}

function FilePickerContent({
  browser,
  allowedContentTypes,
  uploadControl,
  onPick,
  getErrorMessage,
  onOpenChange,
}: Omit<FilePickerProps, "open">) {
  const { t } = useTranslation(["files", "common"])
  const [selection, setSelection] = useState<{
    scope: string
    file: FileResponse
  }>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const controller = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => controller.current?.abort(), [])
  // 目录或列表上下文变化后，旧选择不能被误当成当前可见、可提交的文件。
  const selectionScope = JSON.stringify([
    browser.contentScopeKey,
    browser.currentFolder.id,
    browser.search,
  ])
  const selected =
    browser.status !== "forbidden" && selection?.scope === selectionScope
      ? selection.file
      : undefined
  const canPick = (file: FileResponse) =>
    file.state === "active" &&
    (!allowedContentTypes ||
      allowedContentTypes.includes(file.currentVersion.contentType))
  const eligible =
    selected &&
    canPick(selected) &&
    browser.status === "ready" &&
    !browser.isActionPending &&
    browser.page?.items.some(
      (entry) =>
        entry.kind === "file" &&
        entry.id === selected.id &&
        entry.state === "active"
    )
  const confirm = async () => {
    if (!eligible || pending) return
    setPending(true)
    setError(undefined)
    const request = new AbortController()
    controller.current = request
    try {
      await onPick(
        FileVersionReferenceSchema.parse({
          fileId: selected.id,
          versionId: selected.currentVersion.id,
        }),
        request.signal
      )
    } catch (cause) {
      if (request.signal.aborted) return
      setError(getErrorMessage(cause))
      setPending(false)
      return
    }
    if (request.signal.aborted) return
    setPending(false)
    onOpenChange(false)
  }
  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl"
        aria-busy={pending}
      >
        <DialogHeader>
          <DialogTitle>{t("files:pickFile")}</DialogTitle>
          <DialogDescription>
            {t("files:pickFileDescription")}
          </DialogDescription>
        </DialogHeader>
        <FileBrowser
          {...browser}
          isActionPending={pending || browser.isActionPending}
          canOpenFile={canPick}
          onOpenFile={(file) => {
            setSelection({ scope: selectionScope, file })
            setError(undefined)
          }}
          actions={uploadControl}
        />
        <p role="status" className="min-w-0 text-sm [overflow-wrap:anywhere]">
          {selected
            ? t("files:selectedFile", { name: selected.name })
            : t("files:noFileSelected")}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            {t("common:cancel")}
          </DialogClose>
          <Button
            disabled={!eligible || pending}
            onClick={() => void confirm()}
          >
            {pending ? t("common:submitting") : t("files:useFile")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type FolderPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  browser: PickerBrowserProps
  canPick: (folder: FolderResponse) => boolean
  onPick: (folder: FolderResponse, signal: AbortSignal) => Promise<void>
  getErrorMessage: (error: unknown) => string
}

export function FolderPickerDialog({
  open,
  onOpenChange,
  ...props
}: FolderPickerProps) {
  return open ? (
    <FolderPickerContent
      key={props.browser.contentScopeKey}
      {...props}
      onOpenChange={onOpenChange}
    />
  ) : null
}

function FolderPickerContent({
  browser,
  canPick,
  onPick,
  getErrorMessage,
  onOpenChange,
}: Omit<FolderPickerProps, "open">) {
  const { t } = useTranslation(["files", "common"])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const controller = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => controller.current?.abort(), [])
  const eligible =
    browser.status === "ready" &&
    !browser.isActionPending &&
    canPick(browser.currentFolder)
  const confirm = async () => {
    if (!eligible || pending) return
    setPending(true)
    setError(undefined)
    const request = new AbortController()
    controller.current = request
    try {
      await onPick(browser.currentFolder, request.signal)
    } catch (cause) {
      if (request.signal.aborted) return
      setError(getErrorMessage(cause))
      setPending(false)
      return
    }
    if (request.signal.aborted) return
    setPending(false)
    onOpenChange(false)
  }
  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl"
        aria-busy={pending}
      >
        <DialogHeader>
          <DialogTitle>{t("files:pickFolder")}</DialogTitle>
          <DialogDescription>
            {t("files:pickFolderDescription")}
          </DialogDescription>
        </DialogHeader>
        <FileBrowser
          {...browser}
          isActionPending={pending || browser.isActionPending}
          canOpenFile={() => false}
          onOpenFile={() => undefined}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            {t("common:cancel")}
          </DialogClose>
          <Button
            disabled={!eligible || pending}
            onClick={() => void confirm()}
          >
            {pending ? t("common:submitting") : t("files:useFolder")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
