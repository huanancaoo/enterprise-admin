import { useUploadQueue as useQueue } from "@workspace/admin/files/use-upload-queue"
export type {
  FileUploadTarget,
  FileUploadDraft,
} from "@workspace/admin/files/use-upload-queue"
type Options = Omit<Parameters<typeof useQueue>[0], "ownerKey"> & {
  organizationId: string
}
export function useUploadQueue({ organizationId, ...options }: Options) {
  return useQueue({ ...options, ownerKey: organizationId })
}
