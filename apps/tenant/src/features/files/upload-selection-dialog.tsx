import { useEffect, useId, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  FileNameSchema,
  maxOrganizationUploadBytes,
  type FileResponse,
  type FolderResponse,
} from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { fileRequestErrorMessage } from "./file-queries"

export type FileUploadSelection = { file: File; name: string }
const selectedFileSchema = z.object({
  file: z
    .instanceof(File)
    .refine(
      (file) => file.size <= maxOrganizationUploadBytes,
      "FILE_TOO_LARGE"
    ),
  name: FileNameSchema,
})
const uploadSelectionSchema = z.object({
  items: z.array(selectedFileSchema).min(1, "FILE_REQUIRED"),
})
const overwriteSelectionSchema = z.object({
  items: z.array(selectedFileSchema).length(1, "ONE_FILE_REQUIRED"),
})

type SelectionTarget =
  | {
      kind: "upload"
      parent: FolderResponse
      initialFiles?: FileUploadSelection[]
    }
  | { kind: "overwrite"; target: FileResponse }
type SelectionFormProps = SelectionTarget & {
  contentScopeKey: string
  canSubmit: boolean
  onClose: () => void
  onSubmit: (items: FileUploadSelection[], signal: AbortSignal) => Promise<void>
  returnFocus: () => HTMLElement | null
}

type UploadSelectionDialogProps = SelectionFormProps & { open: boolean }

export function UploadSelectionDialog({
  open,
  ...props
}: UploadSelectionDialogProps) {
  return open ? (
    <SelectionForm
      key={JSON.stringify([
        props.contentScopeKey,
        props.kind,
        props.kind === "upload" ? props.parent.id : props.target.id,
      ])}
      {...props}
    />
  ) : null
}

function SelectionForm(props: SelectionFormProps) {
  const { t } = useTranslation(["files", "common", "errors"])
  const locale = useUiLocale()
  const id = useId()
  const overwrite = props.kind === "overwrite"
  const [error, setError] = useState<string>()
  const registration = useRef<AbortController | null>(null)
  useEffect(() => () => registration.current?.abort(), [])
  const form = useForm({
    defaultValues: {
      items:
        props.kind === "upload"
          ? (props.initialFiles ?? [])
          : ([] as FileUploadSelection[]),
    },
    validators: {
      onSubmit: overwrite ? overwriteSelectionSchema : uploadSelectionSchema,
    },
    onSubmit: async ({ value }) => {
      if (!props.canSubmit) return
      setError(undefined)
      const controller = new AbortController()
      registration.current = controller
      try {
        await props.onSubmit(
          (overwrite ? overwriteSelectionSchema : uploadSelectionSchema).parse(
            value
          ).items,
          controller.signal
        )
        if (!controller.signal.aborted) props.onClose()
      } catch (failure) {
        if (controller.signal.aborted) return
        setError(
          fileRequestErrorMessage(failure, t("files:uploadQueueUnavailable"))
        )
      }
    },
  })
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(submitting) => (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !submitting) props.onClose()
          }}
        >
          <DialogContent showCloseButton={false} finalFocus={props.returnFocus}>
            <DialogHeader>
              <DialogTitle>
                {overwrite ? t("files:overwriteFile") : t("files:uploadFiles")}
              </DialogTitle>
              <DialogDescription>
                {props.kind === "overwrite"
                  ? t("files:overwriteDescription", { name: props.target.name })
                  : t("files:uploadDescription", {
                      folder: props.parent.path.join(" / ") || t("files:root"),
                    })}
              </DialogDescription>
            </DialogHeader>
            <form
              aria-busy={submitting}
              className="space-y-6"
              onSubmit={(event) => {
                event.preventDefault()
                void form.handleSubmit()
              }}
            >
              <fieldset disabled={submitting || !props.canSubmit}>
                <form.Field name="items">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    const addFiles = (files: File[]) => {
                      setError(undefined)
                      if (overwrite && files.length !== 1) {
                        setError(t("files:overwriteChooseOne"))
                        return
                      }
                      const selections = files.map((file) => ({
                        file,
                        name:
                          props.kind === "overwrite"
                            ? props.target.name
                            : file.name,
                      }))
                      field.handleChange(
                        overwrite
                          ? selections
                          : [...field.state.value, ...selections]
                      )
                    }
                    return (
                      <FieldGroup>
                        <Field data-invalid={invalid}>
                          <FieldLabel htmlFor={id}>
                            {t("files:chooseUploadFiles")}
                          </FieldLabel>
                          <div
                            className="space-y-3 rounded-lg border border-dashed p-4"
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault()
                              if (submitting || !props.canSubmit) return
                              // 原生目录拖放不能按零字节 File 处理，否则会把目录误上传成空文件。
                              if (
                                Array.from(event.dataTransfer.items).some(
                                  (item) => item.webkitGetAsEntry()?.isDirectory
                                )
                              ) {
                                setError(t("files:uploadFilesOnly"))
                                return
                              }
                              addFiles(Array.from(event.dataTransfer.files))
                            }}
                          >
                            <Input
                              id={id}
                              type="file"
                              multiple={!overwrite}
                              required={field.state.value.length === 0}
                              aria-invalid={invalid}
                              onBlur={field.handleBlur}
                              onChange={(event) => {
                                const files = Array.from(
                                  event.target.files ?? []
                                )
                                if (files.length) addFiles(files)
                                event.target.value = ""
                              }}
                            />
                            <FieldDescription>
                              {t("files:uploadDropHelp", {
                                maximum: createFormatter(locale).number(
                                  maxOrganizationUploadBytes
                                ),
                              })}
                            </FieldDescription>
                          </div>
                          {invalid && (
                            <FieldError
                              errors={field.state.meta.errors.map(() => ({
                                message: t("files:chooseAtLeastOneFile"),
                              }))}
                            />
                          )}
                        </Field>
                        {field.state.value.map((selection, index) => (
                          <div
                            key={index}
                            className="space-y-3 rounded-lg border p-3"
                          >
                            <form.Field name={`items[${index}].file`}>
                              {(fileField) => (
                                <Field
                                  data-invalid={
                                    fileField.state.meta.isTouched &&
                                    !fileField.state.meta.isValid
                                  }
                                >
                                  <p className="text-sm [overflow-wrap:anywhere]">
                                    {selection.file.name}
                                  </p>
                                  <FieldDescription>
                                    {t("files:byteCount", {
                                      bytes: createFormatter(locale).number(
                                        selection.file.size
                                      ),
                                    })}
                                  </FieldDescription>
                                  {fileField.state.meta.isTouched &&
                                    !fileField.state.meta.isValid && (
                                      <FieldError
                                        errors={fileField.state.meta.errors.map(
                                          () => ({
                                            message: t("errors:FILE_TOO_LARGE"),
                                          })
                                        )}
                                      />
                                    )}
                                </Field>
                              )}
                            </form.Field>
                            {!overwrite && (
                              <form.Field name={`items[${index}].name`}>
                                {(nameField) => {
                                  const nameInvalid =
                                    nameField.state.meta.isTouched &&
                                    !nameField.state.meta.isValid
                                  return (
                                    <Field data-invalid={nameInvalid}>
                                      <FieldLabel htmlFor={`${id}-${index}`}>
                                        {t("files:uploadName")}
                                      </FieldLabel>
                                      <Input
                                        id={`${id}-${index}`}
                                        value={nameField.state.value}
                                        required
                                        autoComplete="off"
                                        aria-invalid={nameInvalid}
                                        onBlur={nameField.handleBlur}
                                        onChange={(event) =>
                                          nameField.handleChange(
                                            event.target.value
                                          )
                                        }
                                      />
                                      {nameInvalid && (
                                        <FieldError
                                          errors={nameField.state.meta.errors.map(
                                            (issue) => ({
                                              message:
                                                issue?.message ===
                                                "FILE_NAME_TOO_LONG"
                                                  ? t(
                                                      "errors:FILE_NAME_TOO_LONG"
                                                    )
                                                  : t(
                                                      "errors:FILE_NAME_INVALID"
                                                    ),
                                            })
                                          )}
                                        />
                                      )}
                                    </Field>
                                  )
                                }}
                              </form.Field>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => field.removeValue(index)}
                            >
                              {t("files:removeSelectedFile", {
                                name: selection.file.name,
                              })}
                            </Button>
                          </div>
                        ))}
                      </FieldGroup>
                    )
                  }}
                </form.Field>
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
                  disabled={submitting}
                  onClick={props.onClose}
                >
                  {t("common:cancel")}
                </Button>
                <Button type="submit" disabled={submitting || !props.canSubmit}>
                  {submitting
                    ? t("common:submitting")
                    : overwrite
                      ? t("files:confirmOverwrite")
                      : t("files:startUpload")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </form.Subscribe>
  )
}
