import { useState } from "react"
import {
  useQuery,
  type QueryKey,
  type UseQueryOptions,
} from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
} from "lucide-react"
import type { FolderView } from "./types"
import { Button } from "@workspace/ui/components/button"
import { fileRequestErrorMessage } from "./file-errors"

type Props<F extends FolderView, Q extends QueryKey> = {
  childrenQuery: (id: string) => UseQueryOptions<F[], Error, F[], Q>
  root: F
  currentFolderId?: string
  ancestors: F[]
  disabled: boolean
  onOpenFolder: (folder: F) => void
}

export function FileDirectoryTree<F extends FolderView, Q extends QueryKey>(
  props: Props<F, Q>
) {
  const { t } = useTranslation("files")
  return (
    <nav aria-label={t("directory")} className="min-w-0 px-2 py-3">
      <ul>
        <DirectoryNode {...props} folder={props.root} />
      </ul>
    </nav>
  )
}

function DirectoryNode<F extends FolderView, Q extends QueryKey>({
  folder,
  ...props
}: Props<F, Q> & { folder: F }) {
  const { t } = useTranslation(["files", "common"])
  const [expansion, setExpansion] = useState<{
    open: boolean
    folderId?: string
  }>()
  const inPath = props.ancestors.some((ancestor) => ancestor.id === folder.id)
  // 从面包屑或表格导航到后代时重新揭示路径；手动收起只作用于当前浏览位置。
  const open =
    (inPath && expansion?.folderId !== props.currentFolderId) ||
    (expansion?.open ?? (folder.parentId === null || inPath))
  const children = useQuery({
    ...props.childrenQuery(folder.id),
    enabled: open,
  })
  const label = folder.parentId === null ? t("files:allFiles") : folder.name
  const active = props.currentFolderId === folder.id
  return (
    <li className="min-w-0">
      <div
        className={`flex min-w-0 items-center rounded-md ${active ? "bg-primary/10 text-primary" : "hover:bg-muted/60"}`}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0 hover:bg-transparent"
          aria-label={t(open ? "files:collapseFolder" : "files:expandFolder", {
            name: label,
          })}
          aria-expanded={open}
          onClick={() =>
            setExpansion({ open: !open, folderId: props.currentFolderId })
          }
        >
          <ChevronRightIcon
            className={`size-3.5 ${open ? "rotate-90" : "rtl:rotate-180"}`}
          />
        </Button>
        <Button
          variant="ghost"
          className="h-10 min-w-0 flex-1 justify-start gap-2 px-1 text-start font-normal hover:bg-transparent hover:text-inherit"
          title={label}
          aria-current={active ? "page" : undefined}
          disabled={props.disabled}
          onClick={() => {
            setExpansion({ open: true, folderId: props.currentFolderId })
            props.onOpenFolder(folder)
          }}
        >
          {open ? (
            <FolderOpenIcon className="size-4 shrink-0" />
          ) : (
            <FolderIcon className="size-4 shrink-0" />
          )}
          <span className="truncate">{label}</span>
        </Button>
      </div>
      {open && (
        <div className="ms-3 border-s border-border/60 ps-2">
          {children.isError ? (
            <div className="space-y-1 px-2 py-2 text-xs">
              <p role="alert" className="text-destructive">
                {fileRequestErrorMessage(
                  children.error,
                  t("common:operationFailed")
                )}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void children.refetch()}
              >
                {t("common:retry")}
              </Button>
            </div>
          ) : children.data ? (
            <ul>
              {children.data.map((child) => (
                <DirectoryNode key={child.id} {...props} folder={child} />
              ))}
            </ul>
          ) : (
            <div
              role="status"
              className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground"
            >
              <LoaderCircleIcon className="size-3 animate-spin" />
              {t("common:loading")}
            </div>
          )}
        </div>
      )}
    </li>
  )
}
