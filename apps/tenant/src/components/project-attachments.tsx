import { useRef, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ErrorState, LoadingState } from "@workspace/admin"
import {
  getFileEntry,
  listFileVersions,
  getProjectAttachmentsOptions,
  requestLanguageHeader,
} from "@workspace/api-client"
import {
  ProjectAttachmentSchema,
  type FileVersionReference,
  type FolderResponse,
  type ProjectAttachment,
} from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
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
import { ConnectedFilePickerDialog } from "@/features/files/connected-file-picker"
import {
  FileDownloadButton,
  ProtectedFilePreview,
} from "@/features/files/file-content"
import {
  getFileEntryOptions,
  getFileVersionsOptions,
  getFileWorkspaceOptions,
  fileRequestErrorMessage,
} from "@/features/files/file-queries"
import { FileUploads } from "@/features/files/file-uploads"
import {
  useProjectAttachmentAccess,
  type AttachmentAccess,
} from "./project-attachment-access"
import { useFileUploadActions } from "@/features/files/upload-context"

export function ProjectAttachmentsField({
  organizationId,
  value,
  onChange,
  access,
  canChange,
}: {
  organizationId: string
  value: ProjectAttachment[]
  onChange: (items: ProjectAttachment[]) => void
  access: AttachmentAccess
  canChange: boolean
}) {
  return (
    <AttachmentInteractions
      key={access.contentScopeKey}
      {...{ organizationId, value, onChange, access, canChange }}
    />
  )
}

function AttachmentInteractions({
  organizationId,
  value,
  onChange,
  access,
  canChange,
}: {
  organizationId: string
  value: ProjectAttachment[]
  onChange: (items: ProjectAttachment[]) => void
  access: AttachmentAccess
  canChange: boolean
}) {
  const { t } = useTranslation(["projects", "files", "common"])
  const locale = useUiLocale()
  const previewFocus = useRef<HTMLElement | null>(null)
  const [selection, setSelection] = useState<{ index?: number } | null>(null)
  const [preview, setPreview] = useState<FileVersionReference | null>(null)
  const openPreview = (reference: FileVersionReference) => {
    previewFocus.current = document.activeElement as HTMLElement
    setPreview(reference)
  }
  const workspace = useQuery({
    ...getFileWorkspaceOptions(
      organizationId,
      access.authorizationVersion,
      locale
    ),
    enabled: !!selection && access.canPick,
  })
  const pick = async (reference: FileVersionReference, signal: AbortSignal) => {
    const options = { signal, headers: { [requestLanguageHeader]: locale } }
    const [entry, versions] = await Promise.all([
      getFileEntry(organizationId, reference.fileId, options),
      listFileVersions(organizationId, reference.fileId, options),
    ])
    const version = versions.data.items.find(
      (item) => item.id === reference.versionId
    )
    if (entry.data.kind !== "file" || !version)
      throw new Error(t("common:operationFailed"))
    const item = ProjectAttachmentSchema.parse({
      ...reference,
      name: entry.data.name,
      bytes: version.bytes,
      contentType: version.contentType,
      versionCreatedAt: version.createdAt,
    })
    if (signal.aborted) return
    // 选择器确认的是固定版本；稍后的库覆盖不会重新解析为当前版本。
    onChange(
      selection?.index === undefined
        ? [...value, item]
        : value.map((old, index) => (index === selection.index ? item : old))
    )
  }
  const children = (
    <div className="min-w-0 space-y-3">
      <AttachmentList
        items={value}
        canRead={access.canReadFiles}
        onPreview={openPreview}
        controls={
          canChange
            ? (index) => (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!access.canPick}
                    onClick={() => setSelection({ index })}
                  >
                    {t("projects:replaceAttachment")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onChange(value.filter((_, i) => i !== index))
                    }
                  >
                    {t("projects:removeAttachment")}
                  </Button>
                </>
              )
            : undefined
        }
      />
      {canChange ? (
        <Button
          variant="outline"
          disabled={!access.canPick}
          onClick={() => setSelection({})}
        >
          {t("projects:addAttachment")}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("projects:attachmentsReadOnly")}
        </p>
      )}
      {canChange && !access.canPick && (
        <p className="text-sm text-muted-foreground">
          {t("projects:attachmentSelectionPermission")}
        </p>
      )}
      {selection && workspace.isPending && <LoadingState />}
      {selection && workspace.isError && (
        <ErrorState
          message={fileRequestErrorMessage(
            workspace.error,
            t("common:operationFailed")
          )}
          onRetry={() => void workspace.refetch()}
        />
      )}
      {selection && workspace.data && access.userId && access.canPick && (
        <ConnectedFilePickerDialog
          organizationId={organizationId}
          authorizationVersion={access.authorizationVersion}
          contentScopeKey={access.contentScopeKey}
          root={workspace.data.root}
          open
          onOpenChange={(open) => {
            if (!open) setSelection(null)
          }}
          onPick={pick}
          uploadControl={
            access.canUpload && canChange
              ? (folder) => <AttachmentUploadButton folder={folder} />
              : undefined
          }
        />
      )}
      {preview && access.canReadFiles && (
        <AttachmentPreview
          key={access.contentScopeKey}
          organizationId={organizationId}
          reference={preview}
          access={access}
          onClose={() => setPreview(null)}
          returnFocus={() => previewFocus.current}
        />
      )}
    </div>
  )
  // 上传队列属于整个附件草稿；目录列表刷新或关闭选择器不能取消其他正在上传的任务。
  return access.userId ? (
    <FileUploads
      userId={access.userId}
      organizationId={organizationId}
      authorizationVersion={access.authorizationVersion}
      contentScopeKey={access.contentScopeKey}
      canUpload={canChange && access.canUpload}
      canOverwrite={false}
      onOpenVersion={openPreview}
    >
      {children}
    </FileUploads>
  ) : (
    children
  )
}

function AttachmentUploadButton({ folder }: { folder: FolderResponse }) {
  const { t } = useTranslation("files")
  const actions = useFileUploadActions()
  return (
    <Button
      id={actions.uploadTriggerId}
      variant="outline"
      onClick={() => actions.onUpload(folder)}
    >
      {t("uploadFiles")}
    </Button>
  )
}

export function ProjectAttachmentsSection({
  organizationId,
  projectId,
}: {
  organizationId: string
  projectId: string
}) {
  const { t } = useTranslation(["projects", "common"])
  const locale = useUiLocale()
  const access = useProjectAttachmentAccess(organizationId)
  const query = useQuery({
    ...getProjectAttachmentsOptions(
      organizationId,
      projectId,
      access.authorizationVersion,
      locale
    ),
    enabled: access.active,
  })
  const [preview, setPreview] = useState<FileVersionReference | null>(null)
  const focus = useRef<HTMLElement | null>(null)
  return (
    <section
      className="min-w-0 space-y-3"
      aria-label={t("projects:attachments")}
    >
      <h2 className="text-lg font-semibold">{t("projects:attachments")}</h2>
      {query.isPending && <LoadingState />}
      {query.isError && (
        <ErrorState
          message={fileRequestErrorMessage(
            query.error,
            t("common:operationFailed")
          )}
          onRetry={() => void query.refetch()}
        />
      )}
      {access.active && !query.isError && query.data && (
        <AttachmentList
          items={query.data.items}
          canRead={access.canReadFiles}
          onPreview={(reference) => {
            focus.current = document.activeElement as HTMLElement
            setPreview(reference)
          }}
        />
      )}
      {preview && access.canReadFiles && (
        <AttachmentPreview
          key={access.contentScopeKey}
          organizationId={organizationId}
          reference={preview}
          access={access}
          onClose={() => setPreview(null)}
          returnFocus={() => focus.current}
        />
      )}
    </section>
  )
}

function AttachmentList({
  items,
  canRead,
  onPreview,
  controls,
}: {
  items: readonly ProjectAttachment[]
  canRead: boolean
  onPreview: (reference: FileVersionReference) => void
  controls?: (index: number) => ReactNode
}) {
  const { t } = useTranslation(["projects", "files"])
  const locale = useUiLocale()
  const format = createFormatter(locale)
  if (!items.length)
    return (
      <p className="text-sm text-muted-foreground">
        {t("projects:noAttachments")}
      </p>
    )
  return (
    <>
      <ul className="space-y-3">
        {items.map((item, index) => (
          <li
            key={`${item.fileId}:${item.versionId}:${index}`}
            className="min-w-0 space-y-2 rounded-md border p-3"
          >
            <p className="font-medium wrap-anywhere">{item.name}</p>
            <p className="text-sm wrap-anywhere text-muted-foreground">
              {t("projects:attachmentMetadata", {
                bytes: format.number(item.bytes),
                type: item.contentType,
                date: format.dateTime(new Date(item.versionCreatedAt), "UTC", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!canRead}
                onClick={() => onPreview(item)}
              >
                {t("files:preview")}
              </Button>
              {controls?.(index)}
            </div>
          </li>
        ))}
      </ul>
      {!canRead && (
        <p className="text-sm text-muted-foreground">
          {t("projects:attachmentContentPermission")}
        </p>
      )}
    </>
  )
}

function AttachmentPreview({
  organizationId,
  reference,
  access,
  onClose,
  returnFocus,
}: {
  organizationId: string
  reference: FileVersionReference
  access: AttachmentAccess
  onClose: () => void
  returnFocus: () => HTMLElement | null
}) {
  const { t } = useTranslation(["projects", "files", "common"])
  const locale = useUiLocale()
  const entry = useQuery(
    getFileEntryOptions(
      organizationId,
      access.authorizationVersion,
      reference.fileId,
      locale
    )
  )
  const versions = useQuery(
    getFileVersionsOptions(
      organizationId,
      access.authorizationVersion,
      reference.fileId,
      locale
    )
  )
  const version = versions.data?.items.find(
    (item) => item.id === reference.versionId
  )
  const target =
    entry.data?.kind === "file" && version
      ? { file: entry.data, version }
      : undefined
  const error = entry.error ?? versions.error
  return (
    <Sheet
      open
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
        <SheetHeader className="pe-20">
          <SheetTitle className="wrap-anywhere">
            {target?.file.name ?? t("files:preview")}
          </SheetTitle>
          <SheetDescription>
            {t("projects:fixedAttachmentVersion")}
          </SheetDescription>
        </SheetHeader>
        <SheetClose
          render={<Button variant="ghost" className="absolute end-4 top-4" />}
        >
          {t("common:close")}
        </SheetClose>
        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-auto px-6 pb-6">
          {(entry.isPending || versions.isPending) && <LoadingState />}
          {error && (
            <ErrorState
              message={fileRequestErrorMessage(
                error,
                t("common:operationFailed")
              )}
              onRetry={() =>
                void Promise.all([entry.refetch(), versions.refetch()])
              }
            />
          )}
          {!error && entry.isSuccess && versions.isSuccess && !target && (
            <p role="alert">{t("common:operationFailed")}</p>
          )}
          {target && !error && (
            <>
              <FileDownloadButton target={target} />
              <ProtectedFilePreview
                target={target}
                contentScopeKey={access.contentScopeKey}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
