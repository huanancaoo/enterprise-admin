import {
  FilePickerDialog as Files,
  FolderPickerDialog as Folders,
} from "@workspace/admin/files"
import type { FileResponse, FolderResponse } from "@workspace/contracts"
export const FilePickerDialog = Files<FileResponse, FolderResponse>
export const FolderPickerDialog = Folders<FileResponse, FolderResponse>
