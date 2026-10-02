import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import type { FileListQuery } from "@workspace/contracts"
import { FilesWorkspace } from "./files-workspace"

const filesPath = "/app/files/$organizationId"

export function FilesRoute() {
  const { organizationId } = useParams({ from: filesPath })
  const search = useSearch({ from: filesPath })
  const navigate = useNavigate({ from: filesPath })
  return (
    <FilesWorkspace
      key={organizationId}
      organizationId={organizationId}
      search={search}
      onSearchChange={(updater) =>
        void navigate({ search: (current: FileListQuery) => updater(current) })
      }
      onOpenFile={(file) =>
        void navigate({
          to: "/app/files/$organizationId/entries/$entryId",
          params: { organizationId, entryId: file.id },
          search: { versionId: file.currentVersion.id },
        })
      }
    />
  )
}
