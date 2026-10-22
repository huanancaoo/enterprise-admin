import {
  executePlatformFileBatch,
  getPlatformFileBatch,
  requestLanguageHeader,
} from "@workspace/api-client"
import type { FileBatchPorts } from "@workspace/admin/files"
import type { SupportedLocale } from "@workspace/contracts"
export function createFileBatchPorts(locale: SupportedLocale): FileBatchPorts {
  const options = (signal: AbortSignal) => ({
    signal,
    headers: { [requestLanguageHeader]: locale },
  })
  return {
    execute: async (input, signal) =>
      (await executePlatformFileBatch(input, options(signal))).data,
    read: async (id, signal) =>
      (await getPlatformFileBatch(id, options(signal))).data,
  }
}
