import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  Link,
  useNavigate,
  useSearch,
  useRouterState,
} from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  WorkspacePage,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@workspace/admin"
import {
  FileWorkspaceBrowser as SharedFileWorkspaceBrowser,
  FileDirectoryTree,
  type FileView as FileResponse,
  type FolderView as FolderResponse,
} from "@workspace/admin/files"
import {
  createPlatformFileFolder,
  getPlatformFileOperation,
  requestLanguageHeader,
} from "@workspace/api-client"
import type {
  FileListQuery,
  PlatformFileWorkspace,
  FileVersionReference,
} from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { buttonVariants } from "@workspace/ui/components/button"
import { FileUploads } from "./file-uploads"
import { FilePathOperations } from "./file-path-operations"
import { FileEntryActions } from "./file-entry-actions"
import { FileBatches } from "./file-batches"
import { FilePreviewPanel } from "./file-preview-panel"
import { useFileBatchActions } from "./batch-context"
import { useFileUploadActions } from "./upload-context"
import {
  type FileScope,
  useFileScope,
  workspaceOptions,
  entriesOptions,
  trashBreadcrumbOptions,
  folderChildrenOptions,
  fileRequestIsDenied,
  fileRequestErrorMessage,
} from "./queries"
import { filePermissions } from "./file-permissions"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"

type FilesWorkspaceProps = {
  scope: FileScope
  search: FileListQuery
  onSearchChange: (updater: (current: FileListQuery) => FileListQuery) => void
  onOpenFile: (file: FileResponse) => void
  onOpenVersion: (reference: FileVersionReference) => void
}
export function FilesRoute() {
  const scope = useFileScope(),
    search = useSearch({ from: "/platform/files" }),
    navigate = useNavigate({ from: "/platform/files" })
  return (
    <FilesWorkspace
      key={scope.contentKey}
      scope={scope}
      search={search}
      onSearchChange={(updater) => void navigate({ search: updater })}
      onOpenFile={(file) =>
        void navigate({
          to: "/platform/files/entries/$entryId",
          params: { entryId: file.id },
          search: { versionId: file.currentVersion.id },
        })
      }
      onOpenVersion={(ref) =>
        void navigate({
          to: "/platform/files/entries/$entryId",
          params: { entryId: ref.fileId },
          search: { versionId: ref.versionId },
        })
      }
    />
  )
}
function FilesWorkspace(props: FilesWorkspaceProps) {
  const { scope } = props,
    { t } = useTranslation(["files", "common"])
  const workspace = useQuery(workspaceOptions(scope))
  usePlatformAccessFailure(workspace.error)
  const permissions = filePermissions(scope)
  if (
    !permissions.canReadFiles ||
    !permissions.canReadFolders ||
    fileRequestIsDenied(workspace.error)
  )
    return (
      <WorkspacePage title={t("title")}>
        <PermissionDeniedState />
      </WorkspacePage>
    )
  if (workspace.isError)
    return (
      <WorkspacePage title={t("title")}>
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
      <WorkspacePage title={t("title")}>
        <LoadingState />
      </WorkspacePage>
    )
  return (
    <FileUploads
      userId={scope.userId}
      scope={scope}
      contentScopeKey={scope.contentKey}
      canUpload={permissions.canUpload}
      canOverwrite={permissions.canUpload && permissions.canUpdateFiles}
      onOpenVersion={props.onOpenVersion}
    >
      <FilePathOperations
        userId={scope.userId}
        scope={scope}
        contentScopeKey={scope.contentKey}
        root={workspace.data.root}
        permissions={permissions}
      >
        <FileBatches
          userId={scope.userId}
          scope={scope}
          contentScopeKey={scope.contentKey}
          root={workspace.data.root}
          permissions={permissions}
        >
          <FileWorkspaceBrowser
            {...props}
            contentScopeKey={scope.contentKey}
            workspace={workspace.data}
            canUpload={permissions.canUpload}
            canOverwrite={permissions.canUpload && permissions.canUpdateFiles}
            canCreateFolder={permissions.canCreateFolder}
            canTrash={permissions.canRestore || permissions.canPurge}
            canManage={
              permissions.canUpdateFiles ||
              permissions.canUpdateFolders ||
              permissions.canDeleteFiles ||
              permissions.canDeleteFolders ||
              permissions.canRestore ||
              permissions.canPurge
            }
          />
        </FileBatches>
      </FilePathOperations>
    </FileUploads>
  )
}
function FileWorkspaceBrowser({
  scope,
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
  contentScopeKey: string
  workspace: PlatformFileWorkspace
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
  // 路由切换时旧目录仍可见，创建和上传必须等待新目录身份生效。
  const navigating = useRouterState({
    select: (state) => state.status === "pending",
  })
  const parentId = search.parentId ?? workspace.root.id
  const trash = search.state === "trashed"
  const breadcrumbs = useQuery({
    ...trashBreadcrumbOptions(scope, search, workspace.root),
    // 活动文件与回收站使用不同路径语义，只在同一视图内保留已确认的路径。
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey.at(-2) === search.state ? previous : undefined,
  })
  const entries = useQuery({
    ...entriesOptions(scope, trash ? search : { ...search, parentId }),
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
      navigating={navigating}
      renderDirectory={(props) => (
        <FileDirectoryTree
          {...props}
          childrenQuery={(id) => folderChildrenOptions(scope, id)}
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
                    to: "/platform/files/entries/$entryId",
                    params: { entryId: entry.id },
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
          to="/platform/files/entries/$entryId"
          params={{ entryId: entry.id }}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("detail")}
        </Link>
      )}
      renderPreview={({ id: entryId, name: fileName }, onClose) => (
        <FilePreviewPanel
          scope={scope}
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
            await createPlatformFileFolder(input, {
              signal,
              headers: { [requestLanguageHeader]: locale },
            })
          ).data,
        readOperation: async (operationId, signal) =>
          (
            await getPlatformFileOperation(operationId, {
              signal,
              headers: { [requestLanguageHeader]: locale },
            })
          ).data,
        onCompleted: () => {
          void queryClient.invalidateQueries({ queryKey: scope.key })
        },
      }}
    />
  )
}
