import {
  getFileEntry,
  getFileVersionContent,
  getFileOperation,
  getProjectContent,
  listFileVersions,
  requestLanguageHeader,
  saveProjectContent,
  uploadOrganizationFile,
} from "@workspace/api-client"
import { SaveProjectContentSchema } from "@workspace/contracts"
import { downloadProtectedFile } from "../files/protected-file-download"
import type {
  FileEntryResponse,
  FileOperationResponse,
  FileVersionReference,
  FileVersions,
  ProjectContentResponse,
  SaveProjectContent,
  SupportedLocale,
  UploadFileFields,
} from "@workspace/contracts"

export type ProjectContentPorts = {
  read: (
    locale: SupportedLocale,
    signal: AbortSignal
  ) => Promise<ProjectContentResponse>
  save: (
    locale: SupportedLocale,
    input: SaveProjectContent,
    signal: AbortSignal
  ) => Promise<ProjectContentResponse>
}
export type ProjectFilePorts = {
  file: (fileId: string, signal: AbortSignal) => Promise<FileEntryResponse>
  versions: (fileId: string, signal: AbortSignal) => Promise<FileVersions>
  image: (reference: FileVersionReference, signal: AbortSignal) => Promise<Blob>
  download: (
    reference: FileVersionReference,
    signal: AbortSignal
  ) => Promise<void>
  upload: (
    fields: UploadFileFields,
    file: File,
    signal: AbortSignal
  ) => Promise<FileOperationResponse>
  operation: (id: string, signal: AbortSignal) => Promise<FileOperationResponse>
}

export function createProjectContentPorts(
  organizationId: string,
  projectId: string,
  requestLanguage: SupportedLocale
): ProjectContentPorts {
  const options = (signal: AbortSignal) => ({
    signal,
    headers: { [requestLanguageHeader]: requestLanguage },
  })
  return {
    read: async (locale, signal) =>
      (
        await getProjectContent(
          organizationId,
          projectId,
          locale,
          options(signal)
        )
      ).data,
    save: async (locale, input, signal) =>
      (
        await saveProjectContent(
          organizationId,
          projectId,
          locale,
          // 递归 Schema 的 TS 输出宽化；运行时先完整校验同源正式 Schema，再进入其封闭 OpenAPI DTO。
          SaveProjectContentSchema.parse(input) as Parameters<
            typeof saveProjectContent
          >[3],
          options(signal)
        )
      ).data,
  }
}

export function createProjectFilePorts(
  organizationId: string,
  requestLanguage: SupportedLocale
): ProjectFilePorts {
  const options = (signal: AbortSignal) => ({
    signal,
    headers: { [requestLanguageHeader]: requestLanguage },
  })
  return {
    file: async (id, signal) =>
      (await getFileEntry(organizationId, id, options(signal))).data,
    versions: async (id, signal) =>
      (await listFileVersions(organizationId, id, options(signal))).data,
    image: async (reference, signal) =>
      (
        await getFileVersionContent(
          organizationId,
          reference.fileId,
          reference.versionId,
          { disposition: "inline" },
          undefined,
          options(signal)
        )
      ).data,
    download: (reference, signal) =>
      downloadProtectedFile(organizationId, reference, signal, requestLanguage),
    upload: async (fields, file, signal) =>
      (
        await uploadOrganizationFile(
          organizationId,
          { ...fields, file },
          options(signal)
        )
      ).data,
    operation: async (id, signal) =>
      (await getFileOperation(organizationId, id, options(signal))).data,
  }
}
