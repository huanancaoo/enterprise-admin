import { useEffect, useId, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  RichTextEditor,
  type JSONContent,
  type RichTextEditorProps,
} from "@workspace/admin"
import {
  FileVersionsSchema,
  FileVersionReferenceSchema,
  type FolderResponse,
  type FileVersionReference,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldLabel,
  FieldError,
  FieldDescription,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { z } from "zod"
import {
  ConnectedFilePickerDialog,
  ConnectedFolderPickerDialog,
} from "../files/connected-file-picker"
import { UploadQueue } from "../files/upload-queue"
import { UploadSelectionDialog } from "../files/upload-selection-dialog"
import { fileRequestErrorMessage } from "../files/file-queries"
import { useProjectImageUploads } from "./project-file-editor-uploads"
import {
  projectFileNodes,
  projectImageContentTypes,
  replaceProjectFileNode,
  type ProjectFileNode,
} from "./project-file-editor-document"
import type { ProjectFilePorts } from "./project-content-ports"
import { ProjectFileEditorError } from "./project-file-editor-errors"

type Props = {
  userId: string
  organizationId: string
  authorizationVersion: number
  contentScopeKey: string
  id?: string
  value: JSONContent
  onChange?: (document: JSONContent) => void
  canBrowse: boolean
  canUpload: boolean
  root?: FolderResponse
  ports: ProjectFilePorts
  onUploadingChange?: (busy: boolean) => void
}
export function ProjectFileEditor(props: Props) {
  return props.onChange ? (
    <EditableProjectFileEditor {...props} onChange={props.onChange} />
  ) : (
    <ReadOnlyProjectFileEditor {...props} />
  )
}
function useFileContentPorts(
  props: Props
): Pick<
  RichTextEditorProps,
  "resolveImage" | "downloadFile" | "getFileErrorMessage" | "contentScopeKey"
> {
  const { t } = useTranslation("common")
  const requests = useRef(new Set<AbortController>())
  useEffect(() => {
    const active = requests.current
    return () => {
      for (const request of active) request.abort()
      active.clear()
    }
  }, [props.contentScopeKey])
  return {
    contentScopeKey: props.contentScopeKey,
    resolveImage: props.ports.image,
    downloadFile: async (reference) => {
      const request = new AbortController()
      requests.current.add(request)
      try {
        await props.ports.download(reference, request.signal)
      } finally {
        requests.current.delete(request)
      }
    },
    getFileErrorMessage: (error) =>
      error instanceof ProjectFileEditorError
        ? error.message
        : fileRequestErrorMessage(error, t("operationFailed")),
  }
}
function ReadOnlyProjectFileEditor(props: Props) {
  const content = useFileContentPorts(props)
  return (
    <RichTextEditor
      variant="document"
      editable={false}
      id={props.id}
      value={props.value}
      {...content}
    />
  )
}
function EditableProjectFileEditor(
  props: Props & { onChange: (document: JSONContent) => void }
) {
  const { t } = useTranslation(["projects", "files", "common"])
  const id = useId()
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  }, [props])
  const content = useFileContentPorts(props)
  const [uploadFolder, setUploadFolder] = useState<FolderResponse | null>(null)
  const [chooseFolder, setChooseFolder] = useState(false)
  const [picker, setPicker] = useState<{
    kind: "fileImage" | "fileAttachment"
    selected?: ProjectFileNode
  }>()
  const [versions, setVersions] = useState<ProjectFileNode>()
  const [uploadTarget, setUploadTarget] = useState<FolderResponse>()
  const uploadFocus = useRef<HTMLElement | null>(null)
  const [error, setError] = useState<string>()
  const uploads = useProjectImageUploads({
    userId: props.userId,
    organizationId: props.organizationId,
    canUpload: props.canUpload,
    ports: props.ports,
  })
  const onUploadingChange = props.onUploadingChange
  useEffect(() => {
    onUploadingChange?.(uploads.uploading)
    return () => onUploadingChange?.(false)
  }, [uploads.uploading, onUploadingChange])
  const references = projectFileNodes(props.value)
  const replace = (
    selected: ProjectFileNode,
    reference: FileVersionReference | null,
    label?: string
  ) => {
    try {
      props.onChange(
        replaceProjectFileNode(props.value, selected, reference, label)
      )
      setError(undefined)
    } catch {
      setError(t("projects:contentReferenceChanged"))
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!props.canBrowse || !props.root}
          onClick={() => setPicker({ kind: "fileImage" })}
        >
          {t("projects:contentAppendImage")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!props.canBrowse || !props.root}
          onClick={() => setPicker({ kind: "fileAttachment" })}
        >
          {t("projects:contentAppendFile")}
        </Button>
        {props.canUpload && (
          <div className="w-full">
            <Field>
              <FieldLabel htmlFor={id + "-upload-folder"}>
                {t("projects:contentUploadFolder")}
              </FieldLabel>
              <Button
                id={id + "-upload-folder"}
                type="button"
                variant="outline"
                disabled={!props.canBrowse || !props.root}
                onClick={() => setChooseFolder(true)}
              >
                {uploadFolder
                  ? uploadFolder.path.join(" / ") || t("files:root")
                  : t("files:pickFolder")}
              </Button>
              <FieldDescription>
                {t("projects:contentUploadHelp")}
              </FieldDescription>
            </Field>
          </div>
        )}
      </div>
      <RichTextEditor
        variant="document"
        id={props.id}
        value={props.value}
        onChange={props.onChange}
        {...content}
        onUploadImage={
          props.canUpload ? uploads.uploadImage(uploadFolder) : undefined
        }
      />
      {references.length > 0 && (
        <ul className="space-y-3" aria-label={t("projects:contentReferences")}>
          {references.map((node, index) => (
            <li
              key={JSON.stringify([node.path, node.reference])}
              className="space-y-2 rounded-md border p-3 text-sm"
            >
              <p className="[overflow-wrap:anywhere]">
                {node.label ||
                  t("projects:contentResource", { number: index + 1 })}
              </p>
              <p className="[overflow-wrap:anywhere] text-muted-foreground">
                {t("projects:contentFixedVersion", {
                  id: node.reference.versionId,
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!props.canBrowse || !props.root}
                  onClick={() => setPicker({ kind: node.type, selected: node })}
                >
                  {t("projects:contentReplaceFile")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!props.canBrowse}
                  onClick={() => setVersions(node)}
                >
                  {t("projects:contentChooseVersion")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => replace(node, null)}
                >
                  {t("projects:contentRemoveReference")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <UploadQueue
        jobs={uploads.queue.jobs.map((job) => ({ ...job, canRetry: false }))}
        onCheck={uploads.queue.check}
        onDismiss={uploads.queue.dismiss}
        onRetry={() => undefined}
      />
      {uploads.queue.recordError && (
        <div>
          <p role="alert">{uploads.queue.recordError}</p>
          <Button
            type="button"
            variant="outline"
            onClick={uploads.queue.retryRecords}
          >
            {t("common:retry")}
          </Button>
        </div>
      )}
      {props.root && (
        <>
          <ConnectedFolderPickerDialog
            organizationId={props.organizationId}
            authorizationVersion={props.authorizationVersion}
            contentScopeKey={props.contentScopeKey}
            root={props.root}
            open={chooseFolder}
            onOpenChange={setChooseFolder}
            canPick={(folder) => folder.state === "active"}
            onPick={async (folder) => {
              setUploadFolder(folder)
            }}
          />
          <ConnectedFilePickerDialog
            organizationId={props.organizationId}
            authorizationVersion={props.authorizationVersion}
            contentScopeKey={props.contentScopeKey}
            root={props.root}
            open={Boolean(picker)}
            onOpenChange={(open) => {
              if (!open) setPicker(undefined)
            }}
            allowedContentTypes={
              picker?.kind === "fileImage"
                ? projectImageContentTypes
                : undefined
            }
            uploadControl={
              props.canUpload
                ? (folder) => (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={(event) => {
                        uploadFocus.current = event.currentTarget
                        setUploadTarget(folder)
                      }}
                    >
                      {t("files:chooseUploadFiles")}
                    </Button>
                  )
                : undefined
            }
            onPick={async (reference, signal) => {
              const file = await props.ports.file(reference.fileId, signal)
              signal.throwIfAborted()
              if (file.kind !== "file" || !picker)
                throw new Error(t("common:operationFailed"))
              if (picker.selected)
                latest.current.onChange(
                  replaceProjectFileNode(
                    latest.current.value,
                    picker.selected,
                    reference,
                    file.name
                  )
                )
              else
                latest.current.onChange({
                  ...latest.current.value,
                  content: [
                    ...(latest.current.value.content ?? []),
                    {
                      type: picker.kind,
                      attrs: {
                        ...reference,
                        [picker.kind === "fileImage" ? "alt" : "label"]:
                          file.name,
                      },
                    },
                    { type: "paragraph" },
                  ],
                })
            }}
          />
        </>
      )}
      {versions && (
        <ProjectFileEditorVersionDialog
          node={versions}
          contentScopeKey={props.contentScopeKey}
          ports={props.ports}
          onClose={() => setVersions(undefined)}
          onPick={(reference) => {
            replace(versions, reference)
            setVersions(undefined)
          }}
        />
      )}
      {uploadTarget && (
        <UploadSelectionDialog
          kind="upload"
          parent={uploadTarget}
          returnFocus={() => uploadFocus.current}
          open
          contentScopeKey={props.contentScopeKey}
          canSubmit={props.canUpload}
          onClose={() => setUploadTarget(undefined)}
          onSubmit={async (items) => {
            uploads.queue.enqueue(
              { kind: "upload", parent: uploadTarget },
              items
            )
          }}
        />
      )}
    </div>
  )
}
const versionSchema = z.object({
  versionId: FileVersionReferenceSchema.shape.versionId,
})
function ProjectFileEditorVersionDialog({
  node,
  contentScopeKey,
  ports,
  onClose,
  onPick,
}: {
  node: ProjectFileNode
  contentScopeKey: string
  ports: ProjectFilePorts
  onClose: () => void
  onPick: (reference: FileVersionReference) => void
}) {
  const { t } = useTranslation(["projects", "common"])
  const id = useId()
  const versions = useQuery({
    queryKey: [
      "project-content-versions",
      contentScopeKey,
      node.reference.fileId,
    ],
    retry: false,
    queryFn: async ({ signal }) =>
      FileVersionsSchema.parse(
        await ports.versions(node.reference.fileId, signal)
      ),
  })
  const choices = versions.data?.items.filter(
    (version) =>
      node.type !== "fileImage" ||
      (projectImageContentTypes as readonly string[]).includes(
        version.contentType
      )
  )
  const form = useForm({
    defaultValues: { versionId: node.reference.versionId },
    validators: { onSubmit: versionSchema },
    onSubmit: ({ value }) => {
      if (choices?.some((version) => version.id === value.versionId))
        onPick({ fileId: node.reference.fileId, versionId: value.versionId })
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("projects:contentChooseVersion")}</DialogTitle>
          <DialogDescription>
            {t("projects:contentVersionHelp")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
          className="space-y-4"
        >
          <form.Field name="versionId">
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={id}>
                    {t("projects:contentVersion")}
                  </FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value) => {
                      if (value) field.handleChange(value)
                    }}
                  >
                    <SelectTrigger
                      id={id}
                      aria-invalid={invalid}
                      onBlur={field.handleBlur}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {choices?.map((version) => (
                        <SelectItem key={version.id} value={version.id}>
                          {version.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
          {versions.isPending && <p role="status">{t("common:loading")}</p>}
          {versions.error && (
            <p role="alert">
              {fileRequestErrorMessage(
                versions.error,
                t("common:operationFailed")
              )}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common:cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!versions.isSuccess || !choices?.length}
            >
              {t("common:save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
