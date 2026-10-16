import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ErrorState, LoadingState } from "@workspace/admin"
import {
  getFileVersionContent,
  getGetFileVersionContentUrl,
  organizationKeys,
  requestLanguageHeader,
} from "@workspace/api-client"
import type { FileResponse, FileVersionResponse } from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { fileRequestErrorMessage, fileRequestIsDenied } from "./file-queries"
import { downloadProtectedFile } from "./protected-file-download"

export type FileContentTarget = {
  file: Pick<FileResponse, "id" | "organizationId" | "name">
  version: FileVersionResponse
}

const textPageBytes = 64 * 1024

// Range 按字节计算；下一页从完整 UTF-8 字符后开始，不能把半个字符解码成替换符。
function completeUtf8Prefix(bytes: Uint8Array): number {
  let start = bytes.length - 1
  while (start >= 0 && (bytes[start]! & 0xc0) === 0x80) start--
  if (start < 0) return bytes.length
  const first = bytes[start]!
  const length = first < 0x80 ? 1 : first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4
  return bytes.length - start < length ? start : bytes.length
}

function contentRequest(
  target: FileContentTarget,
  disposition: "inline" | "attachment",
  signal: AbortSignal,
  locale: string,
  range?: string
) {
  return getFileVersionContent(
    target.file.organizationId,
    target.file.id,
    target.version.id,
    { disposition },
    range ? { Range: range } : undefined,
    { signal, headers: { [requestLanguageHeader]: locale } }
  )
}

export function FileDownloadButton({ target }: { target: FileContentTarget }) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const client = useQueryClient()
  const request = useRef<AbortController | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => () => request.current?.abort(), [])

  const download = async () => {
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError(undefined)
    try {
      await downloadProtectedFile(
        target.file.organizationId,
        { fileId: target.file.id, versionId: target.version.id },
        controller.signal,
        locale
      )
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(fileRequestErrorMessage(failure, t("common:operationFailed")))
      if (fileRequestIsDenied(failure))
        void client.invalidateQueries({
          queryKey: organizationKeys.access(target.file.organizationId),
        })
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => void download()}
      >
        {pending ? t("files:downloading") : t("files:download")}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function ProtectedFilePreview({
  target,
  contentScopeKey,
}: {
  target: FileContentTarget
  contentScopeKey: string
}) {
  const locale = useUiLocale()
  return (
    <PreviewSession
      key={JSON.stringify([contentScopeKey, target.version.id, locale])}
      target={target}
    />
  )
}

function PreviewSession({ target }: { target: FileContentTarget }) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const client = useQueryClient()
  // 私有内容只属于本次预览；重新打开或授权范围变化必须重新向服务端验证。
  const [scope] = useState(() => ["file-preview", crypto.randomUUID()] as const)
  const [offsets, setOffsets] = useState([0])
  const [checkNativeFailure, setCheckNativeFailure] = useState(false)
  const offset = offsets.at(-1)!
  const { file, version } = target
  const preview = useQuery({
    queryKey: [...scope, offset, checkNativeFailure],
    queryFn: ({ signal }) =>
      readPreview(target, offset, checkNativeFailure, signal, locale),
    enabled: version.previewKind !== "none",
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: scope })
      client.removeQueries({ queryKey: scope })
    },
    [client, scope]
  )
  useEffect(() => {
    if (fileRequestIsDenied(preview.error))
      void client.invalidateQueries({
        queryKey: organizationKeys.access(file.organizationId),
      })
  }, [client, file.organizationId, preview.error])

  if (target.version.previewKind === "none")
    return (
      <p className="text-sm text-muted-foreground">
        {t("files:previewUnavailable")}
      </p>
    )
  const ready = preview.isSuccess && !preview.isFetching
  const nextOffset =
    preview.data?.kind === "text" ? preview.data.nextOffset : undefined
  const retry = () => {
    if (checkNativeFailure) setCheckNativeFailure(false)
    else void preview.refetch()
  }
  return (
    <div className="min-w-0 space-y-4">
      {preview.isError ? (
        <ErrorState
          message={fileRequestErrorMessage(
            preview.error,
            t("files:previewReadFailed")
          )}
          onRetry={retry}
        />
      ) : !ready ? (
        <LoadingState />
      ) : preview.data.kind === "unsupported" ? (
        <ErrorState
          message={t("files:previewBrowserUnsupported")}
          onRetry={retry}
        />
      ) : (
        <PreviewContent
          data={preview.data}
          target={target}
          onNativeFailure={() => setCheckNativeFailure(true)}
        />
      )}
      {target.version.previewKind === "text" && (
        <nav
          aria-label={t("files:textPages")}
          className="flex flex-wrap items-center gap-3"
        >
          <Button
            variant="outline"
            disabled={!ready || offsets.length === 1}
            onClick={() => {
              setOffsets((current) => current.slice(0, -1))
            }}
          >
            {t("common:previous")}
          </Button>
          <span className="text-sm">
            {t("files:textPage", {
              page: createFormatter(locale).number(offsets.length),
            })}
          </span>
          <Button
            variant="outline"
            disabled={!ready || nextOffset === undefined}
            onClick={() => {
              setOffsets((current) => [...current, nextOffset!])
            }}
          >
            {t("common:next")}
          </Button>
        </nav>
      )}
    </div>
  )
}

type PreviewData =
  | { kind: "text"; text: string; nextOffset?: number }
  | { kind: "image"; blob: Blob }
  | { kind: "native"; url: string }
  | { kind: "unsupported" }

async function readPreview(
  target: FileContentTarget,
  offset: number,
  checkNativeFailure: boolean,
  signal: AbortSignal,
  locale: string
): Promise<PreviewData> {
  const { file, version } = target
  const kind = version.previewKind
  // 原生媒体与 PDF 只读一字节预检；浏览器解码失败时同样只重新验证授权。
  const range = checkNativeFailure
    ? version.bytes > 0
      ? "bytes=0-0"
      : undefined
    : kind === "text" && version.bytes > 0
      ? `bytes=${offset}-${Math.min(offset + textPageBytes, version.bytes) - 1}`
      : kind === "audio" || kind === "video" || kind === "pdf"
        ? "bytes=0-0"
        : undefined
  const response = await contentRequest(target, "inline", signal, locale, range)
  signal.throwIfAborted()
  if (checkNativeFailure) return { kind: "unsupported" }
  if (kind === "text") {
    const bytes = new Uint8Array(await response.data.arrayBuffer())
    signal.throwIfAborted()
    const end =
      offset + bytes.length >= version.bytes
        ? bytes.length
        : completeUtf8Prefix(bytes)
    return {
      kind: "text",
      text: new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, end)
      ),
      nextOffset: offset + end < version.bytes ? offset + end : undefined,
    }
  }
  if (kind === "image") return { kind: "image", blob: response.data }
  return {
    kind: "native",
    url: getGetFileVersionContentUrl(file.organizationId, file.id, version.id, {
      disposition: "inline",
    }),
  }
}

function PreviewContent({
  data,
  target,
  onNativeFailure,
}: {
  data: Exclude<PreviewData, { kind: "unsupported" }>
  target: FileContentTarget
  onNativeFailure: () => void
}) {
  const { t } = useTranslation("files")
  const { file, version } = target
  if (data.kind === "text")
    return (
      <pre
        role="region"
        tabIndex={0}
        aria-label={t("textContent")}
        className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-4 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap"
      >
        {data.text || t("emptyText")}
      </pre>
    )
  if (data.kind === "image")
    return (
      <PreviewImage
        blob={data.blob}
        name={file.name}
        onError={onNativeFailure}
      />
    )
  if (version.previewKind === "audio")
    return (
      <audio
        src={data.url}
        controls
        aria-label={file.name}
        className="w-full"
        onError={onNativeFailure}
      />
    )
  if (version.previewKind === "video")
    return (
      <video
        src={data.url}
        controls
        aria-label={file.name}
        className="max-h-[70vh] w-full"
        onError={onNativeFailure}
      />
    )
  return (
    <iframe
      src={data.url}
      title={file.name}
      className="h-[70vh] w-full rounded-md border"
      onError={onNativeFailure}
    />
  )
}

function PreviewImage({
  blob,
  name,
  onError,
}: {
  blob: Blob
  name: string
  onError: () => void
}) {
  const image = useRef<HTMLImageElement>(null)
  // Blob URL 属于浏览器显示资源，不能放进 Query 数据或跨预览范围复用。
  useEffect(() => {
    const url = URL.createObjectURL(blob)
    image.current!.src = url
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return (
    <img
      ref={image}
      alt={name}
      className="max-h-[70vh] max-w-full object-contain"
      onError={onError}
    />
  )
}
