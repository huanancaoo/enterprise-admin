import { useId, useState } from "react"
import { useForm, useSelector } from "@tanstack/react-form"
import { useQueries } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  ExecuteFileBatchSchema,
  FileEntryImpactSchema,
  type ExecuteFileBatch,
  type FileBatchActionSchema,
  type FileEntryImpact,
  type FileEntryResponse,
  type FolderResponse,
} from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { fileRequestErrorMessage } from "./file-queries"

type Action = z.infer<typeof FileBatchActionSchema>
const formSchema = (action: Action) =>
  z.object({
    parentId: z
      .uuid()
      .nullable()
      .refine((value) => action !== "move" || value !== null),
    confirmed: z
      .boolean()
      .refine((value) => (action !== "trash" && action !== "purge") || value),
  })
// active 子树只用于预览和权限提示。回收条目的 path 不能区分 trash batch，覆盖事实始终由服务端决定。
function fileBatchPreviewRoot(
  entries: readonly FileEntryResponse[],
  entry: FileEntryResponse,
  action: Action
) {
  if (action !== "move" && action !== "trash") return entry
  return (
    entries
      .filter(
        (ancestor) =>
          ancestor.kind === "folder" &&
          ancestor.state === "active" &&
          entry.state === "active" &&
          ancestor.id !== entry.id &&
          ancestor.path.length < entry.path.length &&
          ancestor.path.every((segment, index) => entry.path[index] === segment)
      )
      .sort((a, b) => a.path.length - b.path.length)[0] ?? entry
  )
}
type Props = {
  open: boolean
  contentScopeKey: string
  action: Action
  entries: readonly FileEntryResponse[]
  canAct: (entry: FileEntryResponse, action: Action) => boolean
  selectFolder: () => Promise<FolderResponse | null>
  readImpact: (
    entryId: string,
    action: "trash" | "purge",
    signal: AbortSignal
  ) => Promise<FileEntryImpact>
  onSubmit: (input: ExecuteFileBatch) => Promise<void>
  onClose: () => void
  returnFocus?: () => HTMLElement | null
}
export function FileBatchDialog({ open, ...props }: Props) {
  return open ? (
    <BatchForm
      key={JSON.stringify([
        props.contentScopeKey,
        props.action,
        props.entries.map((entry) => [entry.id, entry.revision]),
      ])}
      {...props}
    />
  ) : null
}
function BatchForm({
  contentScopeKey,
  action,
  entries,
  canAct,
  selectFolder,
  readImpact,
  onSubmit,
  onClose,
  returnFocus,
}: Omit<Props, "open">) {
  const { t } = useTranslation(["files", "common"])
  const titles = {
    move: t("files:batchMove"),
    trash: t("files:batchTrash"),
    restore: t("files:batchRestore"),
    purge: t("files:batchPurge"),
  }

  const locale = useUiLocale(),
    id = useId()
  const [destination, setDestination] = useState<FolderResponse | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState<string>()
  const destructive = action === "trash" || action === "purge"
  const rootById = new Map(
    entries.map((entry) => [
      entry.id,
      fileBatchPreviewRoot(entries, entry, action),
    ])
  )
  const roots = [
    ...new Map([...rootById.values()].map((root) => [root.id, root])).values(),
  ]
  const permitted =
    entries.length >= 1 &&
    entries.length <= 100 &&
    roots.every((root) => canAct(root, action))
  const impacts = useQueries({
    queries: roots.map((root) => ({
      queryKey: [
        "file-batch-impact",
        contentScopeKey,
        action,
        root.id,
        root.revision,
      ],
      enabled: destructive && permitted,
      retry: false,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const value = FileEntryImpactSchema.parse(
          await readImpact(root.id, action as "trash" | "purge", signal)
        )
        if (value.entryId !== root.id || value.revision !== root.revision)
          throw new Error("Impact revision changed")
        return value
      },
    })),
  })
  const ready = !destructive || impacts.every((result) => result.isSuccess)
  const form = useForm({
    defaultValues: { parentId: null as string | null, confirmed: false },
    validators: { onSubmit: formSchema(action) },
    onSubmit: async ({ value }) => {
      if (!permitted || !ready || choosing) return
      setError(undefined)
      const body = {
        batchId: crypto.randomUUID(),
        action,
        items: entries.map((entry) => ({
          entryId: entry.id,
          expectedRevision: entry.revision,
          operationId: crypto.randomUUID(),
        })),
        ...(value.parentId ? { parentId: value.parentId } : {}),
      }
      try {
        await onSubmit(ExecuteFileBatchSchema.parse(body))
        onClose()
      } catch (cause) {
        setError(fileRequestErrorMessage(cause, t("files:batchUnconfirmed")))
      }
    },
  })
  const busy = useSelector(form.store, (state) => state.isSubmitting)
  const choose = async () => {
    setChoosing(true)
    setError(undefined)
    try {
      const selected = await selectFolder()
      if (selected) {
        setDestination(selected)
        form.setFieldValue("parentId", selected.id)
      }
    } catch (cause) {
      setError(
        fileRequestErrorMessage(cause, t("files:batchDestinationFailed"))
      )
    } finally {
      setChoosing(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !choosing) onClose()
      }}
    >
      <DialogContent
        finalFocus={returnFocus}
        showCloseButton={false}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>{titles[action]}</DialogTitle>
          <DialogDescription>
            {t("files:batchDescription", {
              quantity: new Intl.NumberFormat(locale).format(entries.length),
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          aria-busy={busy || choosing}
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <fieldset disabled={busy || choosing || !permitted}>
            <FieldGroup>
              {(action === "move" || action === "restore") && (
                <form.Field name="parentId">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={id + "-destination"}>
                          {t("files:batchDestination")}
                        </FieldLabel>
                        <Button
                          id={id + "-destination"}
                          type="button"
                          variant="outline"
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                          onClick={() => void choose()}
                        >
                          {destination
                            ? destination.path.join(" / ") || t("files:root")
                            : t(
                                action === "restore"
                                  ? "files:batchOriginalLocation"
                                  : "files:pickFolder"
                              )}
                        </Button>
                        {action === "restore" && destination && (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setDestination(null)
                              field.handleChange(null)
                            }}
                          >
                            {t("files:batchOriginalLocation")}
                          </Button>
                        )}
                        <FieldDescription>
                          {t("files:batchDestinationHelp")}
                        </FieldDescription>
                        {invalid && (
                          <FieldError
                            errors={[
                              { message: t("files:batchChooseDestination") },
                            ]}
                          />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
              )}
              <ul
                className="max-h-[40dvh] space-y-3 overflow-auto"
                aria-label={t("files:batchSelection")}
              >
                {entries.map((entry) => {
                  const root = rootById.get(entry.id)!,
                    index = roots.findIndex((value) => value.id === root.id),
                    result = impacts[index]
                  return (
                    <li
                      key={entry.id}
                      className="rounded-md border p-3 text-sm [overflow-wrap:anywhere]"
                    >
                      <p className="font-medium">
                        {entry.name || t("files:root")}
                      </p>
                      {destructive &&
                        (root.id !== entry.id ? (
                          <p>
                            {t("files:batchImpactCovered", { name: root.name })}
                          </p>
                        ) : result?.data ? (
                          <>
                            <p>
                              {t("files:batchImpact", {
                                files: result.data.fileCount,
                                folders: result.data.folderCount,
                                bytes: new Intl.NumberFormat(locale).format(
                                  result.data.bytes
                                ),
                                references: result.data.referenceCount,
                              })}
                            </p>
                            {result.data.referenceCount > 0 && (
                              <p className="text-destructive">
                                {t("files:batchReferencesBlocked")}
                              </p>
                            )}
                          </>
                        ) : result?.error ? (
                          <p role="alert" className="text-destructive">
                            {fileRequestErrorMessage(
                              result.error,
                              t("files:batchImpactFailed")
                            )}
                          </p>
                        ) : (
                          <p role="status">{t("common:loading")}</p>
                        ))}
                    </li>
                  )
                })}
              </ul>
              {destructive && (
                <form.Field name="confirmed">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id={id + "-confirmation"}
                            checked={field.state.value}
                            onCheckedChange={(value) =>
                              field.handleChange(Boolean(value))
                            }
                            onBlur={field.handleBlur}
                            aria-invalid={invalid}
                          />
                          <FieldLabel htmlFor={id + "-confirmation"}>
                            {t(
                              action === "purge"
                                ? "files:batchPurgeConfirm"
                                : "files:batchTrashConfirm"
                            )}
                          </FieldLabel>
                        </div>
                        <FieldDescription>
                          {t("files:batchServerRechecks")}
                        </FieldDescription>
                        {invalid && (
                          <FieldError
                            errors={[
                              { message: t("files:batchConfirmationRequired") },
                            ]}
                          />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
              )}
            </FieldGroup>
          </fieldset>
          {!permitted && (
            <p role="alert" className="text-sm text-destructive">
              {entries.length > 100 || entries.length === 0
                ? t("files:batchLimit")
                : t("common:permissionDescription")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(busy) => (
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || choosing}
                  onClick={onClose}
                >
                  {t("common:cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={busy || choosing || !permitted || !ready}
                >
                  {busy ? t("common:submitting") : titles[action]}
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  )
}
