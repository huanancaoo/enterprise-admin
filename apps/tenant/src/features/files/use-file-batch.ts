import {
  executeFileBatch,
  getFileBatch,
  requestLanguageHeader,
} from "@workspace/api-client"
import type { SupportedLocale } from "@workspace/contracts/locale"
import type { FileBatchPorts } from "@workspace/admin/files/use-file-batch"
export * from "@workspace/admin/files/use-file-batch"
export function createFileBatchPorts(
  organizationId: string,
  locale: SupportedLocale
): FileBatchPorts {
  const options = (signal: AbortSignal) => ({
    signal,
    headers: { [requestLanguageHeader]: locale },
  })
  return {
    execute: async (input, signal) =>
      (await executeFileBatch(organizationId, input, options(signal))).data,
    read: async (batchId, signal) =>
      (await getFileBatch(organizationId, batchId, options(signal))).data,
  }
}
