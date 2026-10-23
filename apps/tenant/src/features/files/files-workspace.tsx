import { FileWorkspaceBrowser as SharedFileWorkspaceBrowser } from "@workspace/admin/files"
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  WorkspacePage,
} from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  createFileFolder,
  getFileOperation,
  getOrganizationAccessOptions,
  requestLanguageHeader,
} from "@workspace/api-client"
import type {
  FileListQuery,
  FileResponse,
  FolderResponse,
  FileWorkspace,
  FileVersionReference,
} from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { buttonVariants } from "@workspace/ui/components/button"
import { FilePreviewPanel } from "./file-preview-panel"
import { FileDirectoryTree } from "./file-directory-tree"
import { FileUploads } from "./file-uploads"
import { FilePathOperations } from "./file-path-operations"
import { FileEntryActions } from "./file-entry-actions"
import { FileBatches } from "./file-batches"
import { useFileBatchActions } from "./batch-context"
import { useFileUploadActions } from "./upload-context"
import {
  fileRequestErrorMessage,
  fileRequestIsDenied,
  fileKeys,
  getFileBreadcrumbsOptions,
  getFileEntriesOptions,
  getFileWorkspaceOptions,
  getFileTrashBreadcrumbsOptions,
} from "./file-queries"
import { getFilePermissionsOptions } from "./file-permissions"

type FilesWorkspaceProps = {
  organizationId: string
  search: FileListQuery
  onSearchChange: (updater: (current: FileListQuery) => FileListQuery) => void
  onOpenFile: (file: FileResponse) => void
  onOpenVersion: (reference: FileVersionReference) => void
}

export function FilesWorkspace(props: FilesWorkspaceProps) {
  const { t } = useTranslation(["files", "common"])
  const access = useQuery(getOrganizationAccessOptions(props.organizationId))
  if (fileRequestIsDenied(access.error))
    return (
      <WorkspacePage title={t("files:title")}>
        <PermissionDeniedState />
      </WorkspacePage>
    )
  if (access.isError)
    return (
      <WorkspacePage title={t("files:title")}>
        <ErrorState
          message={fileRequestErrorMessage(
            access.error,
            t("common:operationFailed")
          )}
          onRetry={() => void access.refetch()}
        />
      </WorkspacePage>
    )
  if (!access.data)
    return (
      <WorkspacePage title={t("files:title")}>
        <LoadingState />
      </WorkspacePage>
    )
  return (
    <AuthorizedFilesWorkspace
      key={access.data.data.authorizationVersion}
      {...props}
      authorizationVersion={access.data.data.authorizationVersion}
    />
  )
}

function AuthorizedFilesWorkspace({
  authorizationVersion,
  ...props
}: FilesWorkspaceProps & { authorizationVersion: number }) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const session = useAuthenticatedSession()!
  const workspace = useQuery(
    getFileWorkspaceOptions(props.organizationId, authorizationVersion, locale)
  )
  const permissions = useQuery(
    getFilePermissionsOptions(props.organizationId, authorizationVersion)
  )
  const scopeKey = JSON.stringify([
    session.user.id,
    props.organizationId,
    authorizationVersion,
  ])
  if (fileRequestIsDenied(workspace.error))
    return (
      <WorkspacePage title={t("files:title")}>
        <PermissionDeniedState />
      </WorkspacePage>
    )
  if (workspace.isError && !workspace.data)
    return (
      <WorkspacePage title={t("files:title")}>
        <ErrorState
          message={fileRequestErrorMessage(
            workspace.error,
            t("common:operationFailed")
          )}
          onRetry={() => void workspace.refetch()}
        />
      </WorkspacePage>
    )
  if (!workspace.data)
    return (
      <WorkspacePage title={t("files:title")}>
        <LoadingState />
      </WorkspacePage>
    )
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {workspace.isError && (
        <ErrorState
          message={fileRequestErrorMessage(
            workspace.error,
            t("common:operationFailed")
          )}
          onRetry={() => void workspace.refetch()}
        />
      )}
      {permissions.isError && (
        <p role="alert" className="text-sm text-destructive">
          {fileRequestErrorMessage(
            permissions.error,
            t("common:operationFailed")
          )}
        </p>
      )}
      <FileUploads
        key={scopeKey}
        userId={session.user.id}
        organizationId={props.organizationId}
        authorizationVersion={authorizationVersion}
        contentScopeKey={scopeKey}
        canUpload={permissions.isSuccess && permissions.data.canUpload}
        canOverwrite={
          permissions.isSuccess &&
          permissions.data.canUpload &&
          permissions.data.canUpdateFiles
        }
        onOpenVersion={props.onOpenVersion}
      >
        <FilePathOperations
          key={scopeKey}
          userId={session.user.id}
          organizationId={props.organizationId}
          authorizationVersion={authorizationVersion}
          contentScopeKey={scopeKey}
          root={workspace.data.root}
          permissions={permissions.isSuccess ? permissions.data : undefined}
        >
          <FileBatches
            userId={session.user.id}
            organizationId={props.organizationId}
            authorizationVersion={authorizationVersion}
            contentScopeKey={scopeKey}
            root={workspace.data.root}
            permissions={permissions.isSuccess ? permissions.data : undefined}
          >
            <FileWorkspaceBrowser
              {...props}
              authorizationVersion={authorizationVersion}
              contentScopeKey={scopeKey}
              workspace={workspace.data}
              canUpload={permissions.isSuccess && permissions.data.canUpload}
              canOverwrite={
                permissions.isSuccess &&
                permissions.data.canUpload &&
                permissions.data.canUpdateFiles
              }
              canCreateFolder={
                permissions.isSuccess && permissions.data.canCreateFolder
              }
              canTrash={
                permissions.isSuccess &&
                (permissions.data.canRestore || permissions.data.canPurge)
              }
              canManage={
                permissions.isSuccess &&
                (permissions.data.canUpdateFiles ||
                  permissions.data.canUpdateFolders ||
                  permissions.data.canDeleteFiles ||
                  permissions.data.canDeleteFolders ||
                  permissions.data.canRestore ||
                  permissions.data.canPurge)
              }
            />
          </FileBatches>
        </FilePathOperations>
      </FileUploads>
    </div>
  )
}

function FileWorkspaceBrowser({
  organizationId,
  authorizationVersion,
  contentScopeKey,
  workspace,
  canCreateFolder,
  canUpload,
  canOverwrite,
  canTrash,
  canManage,
  search,
  onSearchChange,
}: FilesWorkspaceProps & {
  authorizationVersion: number
  contentScopeKey: string
  workspace: FileWorkspace
  canCreateFolder: boolean
  canUpload: boolean
  canOverwrite: boolean
  canTrash: boolean
  canManage: boolean
}) {
  const { t } = useTranslation("files")
  const locale = useUiLocale()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const upload = useFileUploadActions()
  const batches = useFileBatchActions()
  const parentId = search.parentId ?? workspace.root.id
  const trash = search.state === "trashed"
  const breadcrumbs = useQuery({
    ...(trash
      ? getFileTrashBreadcrumbsOptions(
          organizationId,
          authorizationVersion,
          search.parentId,
          workspace.root,
          locale
        )
      : getFileBreadcrumbsOptions(
          organizationId,
          authorizationVersion,
          parentId,
          locale
        )),
    // 活动文件与回收站使用不同路径语义，只在同一视图内保留已确认的路径。
    placeholderData: (previous, previousQuery) =>
      (previousQuery?.queryKey.at(-3) === "trashed") === trash
        ? previous
        : undefined,
  })
  const entries = useQuery({
    ...getFileEntriesOptions(
      organizationId,
      authorizationVersion,
      trash ? search : { ...search, parentId },
      locale
    ),
    placeholderData: keepPreviousData,
  })
  return (
    <SharedFileWorkspaceBrowser<FileResponse, FolderResponse>
      contentScopeKey={contentScopeKey}
      workspace={workspace}
      search={search}
      onSearchChange={onSearchChange}
      canCreateFolder={canCreateFolder}
      canUpload={canUpload}
      canTrash={canTrash}
      canSelectActions={canOverwrite || canManage}
      breadcrumbs={breadcrumbs}
      entries={entries}
      upload={{ triggerId: upload.uploadTriggerId, onUpload: upload.onUpload }}
      batches={batches}
      renderDirectory={(props) => (
        <FileDirectoryTree
          {...props}
          organizationId={organizationId}
          authorizationVersion={authorizationVersion}
        />
      )}
      renderEntryActions={(entry, options) => (
        <FileEntryActions
          {...options}
          entry={entry}
          canOverwrite={canOverwrite}
          onOpenDetails={
            options.presentation === "menu"
              ? () =>
                  void navigate({
                    to: "/app/files/$organizationId/entries/$entryId",
                    params: { organizationId, entryId: entry.id },
                    search:
                      entry.kind === "file"
                        ? { versionId: entry.currentVersion.id }
                        : {},
                  })
              : undefined
          }
        />
      )}
      renderDetailsLink={(entry) => (
        <Link
          to="/app/files/$organizationId/entries/$entryId"
          params={{ organizationId, entryId: entry.id }}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("detail")}
        </Link>
      )}
      renderPreview={({ id: entryId, name: fileName }, onClose) => (
        <FilePreviewPanel
          organizationId={organizationId}
          authorizationVersion={authorizationVersion}
          entryId={entryId}
          fileName={fileName}
          contentScopeKey={contentScopeKey}
          canOverwrite={canOverwrite}
          onClose={onClose}
        />
      )}
      creation={{
        createFolder: async (input, signal) =>
          (
            await createFileFolder(organizationId, input, {
              signal,
              headers: { [requestLanguageHeader]: locale },
            })
          ).data,
        readOperation: async (operationId, signal) =>
          (
            await getFileOperation(organizationId, operationId, {
              signal,
              headers: { [requestLanguageHeader]: locale },
            })
          ).data,
        onCompleted: () => {
          void Promise.all(
            ["list", "breadcrumbs", "workspace"].map((resource) =>
              queryClient.invalidateQueries({
                queryKey: [
                  ...fileKeys.scope(organizationId),
                  authorizationVersion,
                  resource,
                ],
              })
            )
          )
        },
      }}
    />
  )
}
