import { useEffect, useId, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  FileNameSchema,
  FolderNameSchema,
  maxFileNameBytes,
  maxFolderNameBytes,
  type FileEntryResponse,
  type FolderResponse,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { ConnectedFolderPickerDialog } from "./connected-file-picker"
import type { FilePathCommand } from "./use-file-path-operations"

function entryFormSchema(
  entry: FileEntryResponse,
  action: "rename" | "move" | "restore"
) {
  const name = entry.kind === "folder" ? FolderNameSchema : FileNameSchema
  return z.object({
    name:
      action === "rename"
        ? name.refine((value) => value !== entry.name, "NAME_UNCHANGED")
        : name,
    parentId:
      action === "move"
        ? z
            .uuid()
            .nullable()
            .refine(
              (value) => value !== null && value !== entry.parentId,
              "DESTINATION_REQUIRED"
            )
        : z.uuid().nullable(),
  })
}
type Props = {
  action: "rename" | "move" | "restore"
  entry: FileEntryResponse
  root: FolderResponse
  authorizationVersion: number
  contentScopeKey: string
  open: boolean
  canSubmit: boolean
  execute: (command: FilePathCommand) => Promise<void>
  readEntry: (id: string, signal: AbortSignal) => Promise<FileEntryResponse>
  onClose: () => void
  returnFocus: () => HTMLElement | null
}
export function FileEntryDialog(props: Props) {
  return props.open ? (
    <FileEntryForm
      key={JSON.stringify([
        props.contentScopeKey,
        props.entry.id,
        props.action,
      ])}
      {...props}
    />
  ) : null
}
function FileEntryForm(props: Props) {
  const { t } = useTranslation(["files", "common", "errors"])
  const id = useId()
  const [entry, setEntry] = useState(props.entry)
  const [folder, setFolder] = useState<FolderResponse>()
  const [choosing, setChoosing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = useRef<AbortController | undefined>(undefined)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      refresh.current?.abort()
    }
  }, [])
  const form = useForm({
    defaultValues: { name: entry.name, parentId: null as string | null },
    validators: { onSubmit: entryFormSchema(entry, props.action) },
    onSubmit: async ({ value }) => {
      if (!props.canSubmit || refreshing) return
      setError(undefined)
      try {
        // TanStack 的 Schema 校验不替换表单值；请求按同一 Schema 规范化，草稿保持原样。
        const normalized = entryFormSchema(entry, props.action).parse(value)
        await props.execute(
          props.action === "rename"
            ? { action: "rename", entry, name: normalized.name }
            : props.action === "move"
              ? { action: "move", entry, parentId: normalized.parentId! }
              : {
                  action: "restore",
                  entry,
                  name: normalized.name,
                  ...(normalized.parentId
                    ? { parentId: normalized.parentId }
                    : {}),
                }
        )
        if (live.current) props.onClose()
      } catch (cause) {
        if (live.current)
          setError(
            cause instanceof Error ? cause.message : t("common:operationFailed")
          )
      }
    },
  })
  async function refreshEntry() {
    const controller = new AbortController()
    refresh.current = controller
    setRefreshing(true)
    try {
      const fresh = await props.readEntry(entry.id, controller.signal)
      if (!controller.signal.aborted) {
        // 用户明确刷新后更新 CAS 事实；表单草稿不随列表刷新或语言变化丢失。
        setEntry(fresh)
        setError(undefined)
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : t("common:operationFailed")
        )
    } finally {
      if (!controller.signal.aborted) setRefreshing(false)
    }
  }
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !pending && !refreshing) props.onClose()
          }}
        >
          <DialogContent showCloseButton={false} finalFocus={props.returnFocus}>
            <DialogHeader>
              <DialogTitle>
                {props.action === "rename"
                  ? t("files:renameEntry")
                  : props.action === "move"
                    ? t("files:moveEntry")
                    : t("files:restoreEntry")}
              </DialogTitle>
              <DialogDescription>
                {props.action === "rename"
                  ? t("files:renameDescription", { name: entry.name })
                  : props.action === "move"
                    ? t("files:moveDescription", { name: entry.name })
                    : t("files:restoreDescription", { name: entry.name })}
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-6"
              aria-busy={pending || refreshing}
              onSubmit={(event) => {
                event.preventDefault()
                void form.handleSubmit()
              }}
            >
              <fieldset disabled={pending || refreshing || !props.canSubmit}>
                <FieldGroup>
                  {props.action !== "move" && (
                    <form.Field name="name">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={`${id}-name`}>
                              {t("files:newName")}
                            </FieldLabel>
                            <Input
                              id={`${id}-name`}
                              value={field.state.value}
                              required
                              autoComplete="off"
                              aria-invalid={invalid}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                            />
                            <FieldDescription>
                              {t("files:folderNameHelp", {
                                maximum:
                                  entry.kind === "folder"
                                    ? maxFolderNameBytes
                                    : maxFileNameBytes,
                              })}
                            </FieldDescription>
                            {invalid && (
                              <FieldError
                                errors={field.state.meta.errors.map(
                                  (issue) => ({
                                    message:
                                      issue?.message === "NAME_UNCHANGED"
                                        ? t("files:nameMustChange")
                                        : issue?.message ===
                                              "FOLDER_NAME_TOO_LONG" ||
                                            issue?.message ===
                                              "FILE_NAME_TOO_LONG"
                                          ? entry.kind === "folder"
                                            ? t("files:folderNameTooLong")
                                            : t("errors:FILE_NAME_TOO_LONG")
                                          : t("files:folderNameInvalid"),
                                  })
                                )}
                              />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                  )}
                  {props.action !== "rename" && (
                    <form.Field name="parentId">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={`${id}-parent`}>
                              {props.action === "move"
                                ? t("files:destination")
                                : t("files:restoreLocation")}
                            </FieldLabel>
                            <FieldDescription>
                              {folder
                                ? t("files:selectedFolder", {
                                    name:
                                      folder.path.join(" / ") ||
                                      t("files:root"),
                                  })
                                : props.action === "move"
                                  ? t("files:noDestination")
                                  : t("files:originalLocation")}
                            </FieldDescription>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                id={`${id}-parent`}
                                type="button"
                                variant="outline"
                                aria-invalid={invalid}
                                onClick={() => setChoosing(true)}
                              >
                                {props.action === "move"
                                  ? t("files:chooseDestination")
                                  : t("files:chooseRestoreLocation")}
                              </Button>
                              {folder && props.action === "restore" && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    field.handleChange(null)
                                    setFolder(undefined)
                                  }}
                                >
                                  {t("files:originalLocation")}
                                </Button>
                              )}
                            </div>
                            {invalid && (
                              <FieldError
                                errors={field.state.meta.errors.map(() => ({
                                  message: t("files:noDestination"),
                                }))}
                              />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                  )}
                </FieldGroup>
              </fieldset>
              {!props.canSubmit && (
                <p role="alert" className="text-sm text-destructive">
                  {t("common:permissionDescription")}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || refreshing}
                  onClick={props.onClose}
                >
                  {t("common:cancel")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || refreshing || !props.canSubmit}
                  onClick={() => void refreshEntry()}
                >
                  {t("files:refreshEntry")}
                </Button>
                <Button
                  type="submit"
                  disabled={pending || refreshing || !props.canSubmit}
                >
                  {pending
                    ? t("common:submitting")
                    : props.action === "rename"
                      ? t("files:renameEntry")
                      : props.action === "move"
                        ? t("files:moveEntry")
                        : t("files:restoreEntry")}
                </Button>
              </DialogFooter>
            </form>
            <ConnectedFolderPickerDialog
              open={choosing}
              onOpenChange={setChoosing}
              organizationId={entry.organizationId}
              authorizationVersion={props.authorizationVersion}
              contentScopeKey={props.contentScopeKey}
              root={props.root}
              canPick={(target) => {
                if (target.state !== "active" || target.id === entry.id)
                  return false
                if (props.action !== "move") return true
                if (target.id === entry.parentId) return false
                return (
                  entry.kind !== "folder" ||
                  !entry.path.every(
                    (segment, index) => target.path[index] === segment
                  )
                )
              }}
              onPick={async (target) => {
                form.setFieldValue("parentId", target.id)
                setFolder(target)
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </form.Subscribe>
  )
}
