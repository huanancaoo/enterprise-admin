import type { ComponentProps } from "react"
import { FileEntryDialog as Shared } from "@workspace/admin/files/file-entry-dialog"
import type {
  FileEntryResponse,
  FolderResponse,
} from "@workspace/contracts/files"
import { ConnectedFolderPickerDialog } from "./connected-file-picker"
type Props = Omit<
  ComponentProps<typeof Shared<FileEntryResponse>>,
  "renderFolderPicker" | "root"
> & { root: FolderResponse; authorizationVersion: number }
export function FileEntryDialog(props: Props) {
  return (
    <Shared
      {...props}
      renderFolderPicker={(picker) => (
        <ConnectedFolderPickerDialog
          {...picker}
          organizationId={props.entry.organizationId}
          authorizationVersion={props.authorizationVersion}
          contentScopeKey={props.contentScopeKey}
          root={props.root}
        />
      )}
    />
  )
}
