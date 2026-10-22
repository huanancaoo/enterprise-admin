import {
  FileBrowser as Browser,
  FileBreadcrumbNavigation as Breadcrumbs,
  type FileBrowserProps as BrowserProps,
} from "@workspace/admin/files"
import type { FileResponse, FolderResponse } from "@workspace/contracts"
export const FileBrowser = Browser<FileResponse, FolderResponse>
export const FileBreadcrumbNavigation = Breadcrumbs<FolderResponse>
export type FileBrowserProps = BrowserProps<FileResponse, FolderResponse>
