import type {
  FileResponse,
  FolderResponse,
  FilePage,
} from "@workspace/contracts"
export type FileView = Omit<FileResponse, "organizationId">
export type FolderView = Omit<FolderResponse, "organizationId">
export type FileEntryView = FileView | FolderView
export type FilePageView = Omit<FilePage, "items"> & { items: FileEntryView[] }
export type FileBreadcrumbsView = { items: FolderView[] }
