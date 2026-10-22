import type { ComponentProps } from "react"
import { FileDeleteDialog as Shared } from "@workspace/admin/files/file-delete-dialog"
import type { FileEntryResponse } from "@workspace/contracts/files"
type Props = ComponentProps<typeof Shared<FileEntryResponse>> & {
  authorizationVersion: number
}
export function FileDeleteDialog(props: Props) {
  return <Shared {...props} />
}
