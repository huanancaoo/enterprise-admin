import { useEffect, useId, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { ApiClientError } from "@workspace/api-client"
import {
  CreateFolderSchema,
  FolderNameSchema,
  maxFolderNameBytes,
  type CreateFolder,
  type FileOperationResponse,
  type FolderResponse,
} from "@workspace/contracts"
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
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  fileRequestErrorMessage,
  getFileOperationOptions,
} from "./file-queries"

const folderFormSchema = z.object({ name: FolderNameSchema })

type CreateFolderDialogProps = {
  open: boolean
  contentScopeKey: string
  parent: FolderResponse
  authorizationVersion: number
  canCreate: boolean
  onClose: () => void
  onCompleted: (operation: FileOperationResponse) => void
  createFolder: (
    input: CreateFolder,
    signal: AbortSignal
  ) => Promise<FileOperationResponse>
  readOperation: (
    operationId: string,
    signal: AbortSignal
  ) => Promise<FileOperationResponse>
  returnFocus: () => HTMLElement | null
}

export function CreateFolderDialog({
  open,
  ...props
}: CreateFolderDialogProps) {
  return open ? (
    <CreateFolderForm
      key={JSON.stringify([props.contentScopeKey, props.parent.id])}
      {...props}
    />
  ) : null
}

type CreationState =
  "draft" | "submitting" | "processing" | "unconfirmed" | "rejected" | "failed"

function CreateFolderForm({
  parent,
  authorizationVersion,
  canCreate,
  onClose,
  onCompleted,
  createFolder,
  readOperation,
  returnFocus,
}: Omit<CreateFolderDialogProps, "open" | "contentScopeKey">) {
  const { t } = useTranslation(["files", "common", "errors"])
  const locale = useUiLocale()
  const id = useId()
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const [state, setState] = useState<CreationState>("draft")
  const [error, setError] = useState<string>()
  const [operation, setOperation] = useState<FileOperationResponse>()
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const awaiting =
    state === "submitting" || state === "processing" || state === "unconfirmed"

  const acceptOperation = (value: FileOperationResponse) => {
    setOperation(value)
    setError(undefined)
    if (value.phase === "completed") {
      onCompleted(value)
      onClose()
    } else if (value.phase === "failed") {
      setState("failed")
    } else {
      setState("processing")
    }
  }
  const status = useQuery({
    ...getFileOperationOptions(
      parent.organizationId,
      authorizationVersion,
      operationId,
      locale
    ),
    enabled: state === "processing" || state === "unconfirmed",
    queryFn: async ({ signal }) => {
      const value = await readOperation(operationId, signal)
      if (!signal.aborted) acceptOperation(value)
      return value
    },
  })
  const form = useForm({
    defaultValues: { name: "" },
    validators: { onSubmit: folderFormSchema },
    onSubmit: async ({ value }) => {
      if (awaiting || !canCreate) return
      // 已受理的失败绑定原 UUID 与请求；只有用户明确“重新创建”才开始新的操作身份。
      const nextId =
        state === "failed" || state === "rejected"
          ? crypto.randomUUID()
          : operationId
      const input = CreateFolderSchema.parse({
        operationId: nextId,
        parentId: parent.id,
        name: value.name,
      })
      setOperationId(nextId)
      setState("submitting")
      setError(undefined)
      setOperation(undefined)
      const controller = new AbortController()
      request.current = controller
      try {
        const result = await createFolder(input, controller.signal)
        if (!controller.signal.aborted) acceptOperation(result)
      } catch (failure) {
        if (controller.signal.aborted) return
        setError(
          fileRequestErrorMessage(failure, t("files:createResultUnconfirmed"))
        )
        // 4xx 表示本次创建未提交；5xx 可能发生在提交确认丢失后，只能先查询原 UUID。
        setState(
          failure instanceof ApiClientError && failure.status < 500
            ? "rejected"
            : "unconfirmed"
        )
      }
    },
  })
  const retryCreation = state === "failed" || state === "rejected"
  const reason = operation?.errorCode
    ? t(`errors:${operation.errorCode}`)
    : error
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !awaiting) onClose()
      }}
    >
      <DialogContent showCloseButton={false} finalFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>{t("files:createFolder")}</DialogTitle>
          <DialogDescription>
            {t("files:createFolderDescription", {
              folder: parent.path.join(" / ") || t("files:root"),
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
          aria-busy={awaiting}
          className="space-y-6"
        >
          <fieldset disabled={awaiting || !canCreate}>
            <form.Field name="name">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={id}>
                      {t("files:folderName")}
                    </FieldLabel>
                    <Input
                      id={id}
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
                        maximum: maxFolderNameBytes,
                      })}
                    </FieldDescription>
                    {invalid && (
                      <FieldError
                        errors={field.state.meta.errors.map((issue) => ({
                          message:
                            issue?.message === "FOLDER_NAME_TOO_LONG"
                              ? t("files:folderNameTooLong")
                              : t("files:folderNameInvalid"),
                        }))}
                      />
                    )}
                  </Field>
                )
              }}
            </form.Field>
          </fieldset>
          {!canCreate && (
            <p role="alert" className="text-sm text-destructive">
              {t("common:permissionDescription")}
            </p>
          )}
          {reason && (
            <p role="alert" className="text-sm text-destructive">
              {reason}
            </p>
          )}
          {awaiting && (
            <p role="status" className="text-sm">
              {state === "submitting"
                ? t("common:submitting")
                : state === "processing"
                  ? t("files:folderCreating")
                  : t("files:createResultUnconfirmed")}
            </p>
          )}
          {status.isError && (
            <p role="alert" className="text-sm text-destructive">
              {fileRequestErrorMessage(
                status.error,
                t("files:operationStatusUnavailable")
              )}
            </p>
          )}
          {retryCreation && (
            <p className="text-sm text-muted-foreground">
              {t("files:recreateFolderDescription")}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={awaiting}
              onClick={onClose}
            >
              {t("common:cancel")}
            </Button>
            {state === "unconfirmed" || state === "processing" ? (
              <Button
                type="button"
                variant="outline"
                disabled={status.isFetching}
                onClick={() => void status.refetch()}
              >
                {t("files:checkOperation")}
              </Button>
            ) : (
              <Button type="submit" disabled={awaiting || !canCreate}>
                {state === "submitting"
                  ? t("common:submitting")
                  : retryCreation
                    ? t("files:recreateFolder")
                    : t("files:createFolder")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
