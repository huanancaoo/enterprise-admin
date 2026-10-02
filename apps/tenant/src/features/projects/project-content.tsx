import { useEffect, useId, useRef, useState } from "react"
import { useForm, useSelector } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ApiClientError,
  getOrganizationAccessOptions,
  projectKeys,
} from "@workspace/api-client"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  type JSONContent,
} from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  ProjectContentResponseSchema,
  ProjectRichTextDocumentSchema,
  SaveProjectContentSchema,
  SupportedLocaleSchema,
  type ProjectContentResponse,
  type SupportedLocale,
  type FolderResponse,
} from "@workspace/contracts"
import { localeMeta, supportedLocales } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { z } from "zod"
import { authClient } from "@/lib/auth-client"
import { getFilePermissionsOptions } from "../files/file-permissions"
import {
  fileKeys,
  fileRequestErrorMessage,
  getFileWorkspaceOptions,
} from "../files/file-queries"
import { ProjectFileEditor } from "./project-file-editor"
import {
  createProjectContentPorts,
  createProjectFilePorts,
  type ProjectContentPorts,
  type ProjectFilePorts,
} from "./project-content-ports"

export function ProjectContent({
  organizationId,
  projectId,
  initialLocale,
}: {
  organizationId: string
  projectId: string
  initialLocale: SupportedLocale
}) {
  const session = useAuthenticatedSession()!
  const access = useQuery(getOrganizationAccessOptions(organizationId))
  if (
    access.error instanceof ApiClientError &&
    (access.error.status === 401 || access.error.status === 403)
  )
    return <PermissionDeniedState />
  if (access.isError)
    return <ErrorState onRetry={() => void access.refetch()} />
  if (!access.data) return <LoadingState />
  return (
    <AuthorizedProjectContent
      key={JSON.stringify([
        session.user.id,
        organizationId,
        projectId,
        access.data.data.authorizationVersion,
      ])}
      userId={session.user.id}
      organizationId={organizationId}
      projectId={projectId}
      initialLocale={initialLocale}
      authorizationVersion={access.data.data.authorizationVersion}
    />
  )
}
function AuthorizedProjectContent({
  userId,
  organizationId,
  projectId,
  initialLocale,
  authorizationVersion,
}: {
  userId: string
  organizationId: string
  projectId: string
  initialLocale: SupportedLocale
  authorizationVersion: number
}) {
  const { t } = useTranslation("common")
  const locale = useUiLocale()
  const contentScopeKey = JSON.stringify([
    userId,
    organizationId,
    authorizationVersion,
  ])
  const permission = useQuery({
    queryKey: ["project-content-permission", contentScopeKey],
    retry: false,
    queryFn: async ({ signal }) => {
      const check = async (action: "update" | "translate") => {
        const result = await authClient.organization.hasPermission({
          organizationId,
          permissions: { project: [action] },
          fetchOptions: { signal },
        })
        if (result.error) throw new Error(result.error.message)
        return result.data.success
      }
      const [update, translate] = await Promise.all([
        check("update"),
        check("translate"),
      ])
      return update || translate
    },
  })
  const files = useQuery(
    getFilePermissionsOptions(organizationId, authorizationVersion)
  )
  const canBrowse = Boolean(
    files.data?.canReadFiles && files.data.canReadFolders
  )
  const workspace = useQuery({
    ...getFileWorkspaceOptions(organizationId, authorizationVersion, locale),
    enabled: Boolean(permission.data && canBrowse),
  })
  if (permission.isPending || files.isPending) return <LoadingState />
  return (
    <div className="space-y-4">
      {(permission.isError || files.isError || workspace.isError) && (
        <p role="alert">
          {fileRequestErrorMessage(
            permission.error ?? files.error ?? workspace.error,
            t("operationFailed")
          )}
        </p>
      )}
      <ProjectContentPanel
        userId={userId}
        organizationId={organizationId}
        projectId={projectId}
        authorizationVersion={authorizationVersion}
        contentScopeKey={contentScopeKey}
        initialLocale={initialLocale}
        canEdit={permission.data === true}
        canBrowse={canBrowse}
        canUpload={canBrowse && files.data?.canUpload === true}
        root={workspace.data?.root}
        ports={createProjectContentPorts(organizationId, projectId, locale)}
        filePorts={createProjectFilePorts(organizationId, locale)}
      />
    </div>
  )
}

type Draft = {
  revision: number | null
  document: JSONContent
  dirty: boolean
  saved?: boolean
}
type PanelProps = {
  userId: string
  organizationId: string
  projectId: string
  authorizationVersion: number
  contentScopeKey: string
  initialLocale: SupportedLocale
  canEdit: boolean
  canBrowse: boolean
  canUpload: boolean
  root?: FolderResponse
  ports: ProjectContentPorts
  filePorts: ProjectFilePorts
}
const emptyDocument: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
}
export function ProjectContentPanel(props: PanelProps) {
  return (
    <ContentSession
      key={JSON.stringify([props.contentScopeKey, props.projectId])}
      {...props}
    />
  )
}
function ContentSession(props: PanelProps) {
  const { t } = useTranslation(["projects", "common"])
  const language = useUiLocale()
  const id = useId()
  const client = useQueryClient()
  const [locale, setLocale] = useState(props.initialLocale)
  const [drafts, setDrafts] = useState<Partial<Record<SupportedLocale, Draft>>>(
    {}
  )
  const [saving, setSaving] = useState(false)
  const [reset, setReset] = useState(0)
  const [refreshError, setRefreshError] = useState<
    Partial<Record<SupportedLocale, boolean>>
  >({})
  const queryKey = [
    "project-content",
    props.contentScopeKey,
    props.projectId,
    locale,
    language,
  ]
  const query = useQuery({
    queryKey,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = ProjectContentResponseSchema.parse(
        await props.ports.read(locale, signal)
      )
      if (response.locale !== locale)
        throw new Error("Unexpected content language")
      return response
    },
  })
  const draft: Draft | undefined =
    drafts[locale] ??
    (query.data
      ? {
          revision: query.data.revision,
          document: query.data.document ?? emptyDocument,
          dirty: false,
        }
      : undefined)
  const reload = async () => {
    const response = await query.refetch()
    if (response.data && !response.error) {
      setDrafts((previous) => ({
        ...previous,
        [locale]: {
          revision: response.data!.revision,
          document: response.data!.document ?? emptyDocument,
          dirty: false,
        },
      }))
      setReset((value) => value + 1)
      setRefreshError((previous) => ({ ...previous, [locale]: false }))
    }
  }
  const saved = async (response: ProjectContentResponse) => {
    setSaving(false)
    // 先采用正式写回执；后续读回失败不能把已提交的正文改判为保存失败或重发 PUT。
    setDrafts((previous) => ({
      ...previous,
      [locale]: {
        revision: response.revision,
        document: response.document!,
        dirty: false,
        saved: true,
      },
    }))
    client.setQueryData(queryKey, response)
    void client.invalidateQueries({
      queryKey: projectKeys.all(props.organizationId),
    })
    void client.invalidateQueries({
      queryKey: fileKeys.scope(props.organizationId),
    })
    const refreshed = await query.refetch()
    setRefreshError((previous) => ({
      ...previous,
      [locale]: Boolean(refreshed.error),
    }))
  }
  const denied =
    query.error instanceof ApiClientError &&
    (query.error.status === 401 || query.error.status === 403)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("projects:contentTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field>
          <FieldLabel htmlFor={id + "-locale"}>
            {t("projects:contentLocale")}
          </FieldLabel>
          <Select
            items={supportedLocales.map((value) => ({
              value,
              label: localeMeta[value].label,
            }))}
            value={locale}
            onValueChange={(value) => {
              const next = SupportedLocaleSchema.safeParse(value)
              if (next.success) {
                setLocale(next.data)
                setRefreshError((previous) => ({
                  ...previous,
                  [next.data]: false,
                }))
              }
            }}
            disabled={saving}
          >
            <SelectTrigger id={id + "-locale"}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {supportedLocales.map((value) => (
                <SelectItem key={value} value={value}>
                  {localeMeta[value].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{t("projects:contentLocaleHelp")}</FieldDescription>
        </Field>
        {denied ? (
          <PermissionDeniedState />
        ) : (
          <>
            {query.isPending && !draft && <LoadingState />}
            {query.error && (
              <p role="alert" className="text-destructive">
                {fileRequestErrorMessage(
                  query.error,
                  t("common:operationFailed")
                )}
              </p>
            )}
            {draft?.saved && !draft.dirty && (
              <p role="status">
                {t(
                  refreshError[locale]
                    ? "projects:contentSavedRefreshFailed"
                    : "projects:contentSaved"
                )}
              </p>
            )}
            {draft &&
              (props.canEdit ? (
                <ProjectContentForm
                  key={JSON.stringify([locale, draft.revision, reset])}
                  {...props}
                  locale={locale}
                  draft={draft}
                  onSaving={setSaving}
                  onDraft={(document) =>
                    setDrafts((previous) => ({
                      ...previous,
                      [locale]: {
                        ...draft,
                        document,
                        dirty: true,
                        saved: false,
                      },
                    }))
                  }
                  onSaved={saved}
                  onReload={() => void reload()}
                />
              ) : query.data?.document ? (
                <div dir={localeMeta[locale].direction}>
                  <ProjectFileEditor
                    {...props}
                    value={query.data.document}
                    canBrowse={false}
                    canUpload={false}
                    ports={props.filePorts}
                  />
                </div>
              ) : (
                <p>{t("projects:contentEmpty")}</p>
              ))}
            {!draft && query.isError && (
              <Button variant="outline" onClick={() => void query.refetch()}>
                {t("common:retry")}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
const documentFormSchema = z.object({
  expectedRevision: SaveProjectContentSchema.shape.expectedRevision,
  document: z.custom<JSONContent>(
    (value) => ProjectRichTextDocumentSchema.safeParse(value).success
  ),
})
function ProjectContentForm({
  locale,
  draft,
  onDraft,
  onSaved,
  onSaving,
  onReload,
  ...props
}: PanelProps & {
  locale: SupportedLocale
  draft: Draft
  onDraft: (document: JSONContent) => void
  onSaved: (response: ProjectContentResponse) => Promise<void>
  onSaving: (pending: boolean) => void
  onReload: () => void
}) {
  const { t } = useTranslation(["projects", "common"])
  const id = useId()
  const [error, setError] = useState<string>()
  const [uploading, setUploading] = useState(false)
  const request = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => request.current?.abort(), [])
  const form = useForm({
    defaultValues: {
      expectedRevision: draft.revision,
      document: draft.document,
    },
    validators: { onSubmit: documentFormSchema },
    onSubmit: async ({ value }) => {
      if (uploading) return
      setError(undefined)
      onSaving(true)
      const controller = new AbortController()
      request.current = controller
      try {
        const result = ProjectContentResponseSchema.parse(
          await props.ports.save(
            locale,
            SaveProjectContentSchema.parse(value),
            controller.signal
          )
        )
        if (
          result.locale !== locale ||
          result.revision === null ||
          !result.document
        )
          throw new Error("Unexpected saved content receipt")
        if (!controller.signal.aborted) await onSaved(result)
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            fileRequestErrorMessage(cause, t("projects:contentSaveUnconfirmed"))
          )
      } finally {
        if (!controller.signal.aborted) onSaving(false)
      }
    },
  })
  const busy = useSelector(form.store, (state) => state.isSubmitting)
  return (
    <form
      className="space-y-4"
      aria-busy={busy}
      onSubmit={(event) => {
        // 正文表单只提交自己的事件；Portal 中的文件表单保持各自发布边界。
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="document">
        {(field) => {
          const invalid =
            field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <Field data-invalid={invalid}>
              <FieldLabel id={id + "-label"} htmlFor={id}>
                {t("projects:contentBody")}
              </FieldLabel>
              <div
                inert={busy}
                role="group"
                aria-labelledby={id + "-label"}
                aria-invalid={invalid}
                dir={localeMeta[locale].direction}
                onBlur={field.handleBlur}
              >
                <ProjectFileEditor
                  {...props}
                  id={id}
                  value={field.state.value}
                  ports={props.filePorts}
                  onUploadingChange={setUploading}
                  onChange={(document) => {
                    field.handleChange(document)
                    onDraft(document)
                  }}
                />
              </div>
              {invalid && (
                <FieldError
                  errors={[{ message: t("projects:contentInvalidDocument") }]}
                />
              )}
            </Field>
          )
        }}
      </form.Field>
      {uploading && <p role="status">{t("projects:contentUploadsPending")}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || uploading || !draft.dirty}>
          {busy ? t("common:submitting") : t("projects:contentSave")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || uploading}
          onClick={onReload}
        >
          {t("projects:contentReload")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("projects:contentDraftHelp")}
      </p>
    </form>
  )
}
