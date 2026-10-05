import { useCallback, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
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
  const [offsets, setOffsets] = useState([0])
  const [nextOffset, setNextOffset] = useState<number>()
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const offset = offsets.at(-1)!
  const locale = useUiLocale()
  const onReady = useCallback((next?: number) => {
    setNextOffset(next)
    setReady(true)
  }, [])
  if (target.version.previewKind === "none")
    return (
      <p className="text-sm text-muted-foreground">
        {t("files:previewUnavailable")}
      </p>
    )
  return (
    <div className="min-w-0 space-y-4">
      <PreviewRequest
        key={JSON.stringify([offset, attempt])}
        target={target}
        offset={offset}
        onReady={onReady}
        onRetry={() => {
          setReady(false)
          setAttempt((current) => current + 1)
        }}
      />
      {target.version.previewKind === "text" && (
        <nav
          aria-label={t("files:textPages")}
          className="flex flex-wrap items-center gap-3"
        >
          <Button
            variant="outline"
            disabled={!ready || offsets.length === 1}
            onClick={() => {
              setReady(false)
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
              setReady(false)
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

type PreviewData = { text: string } | { url: string }

function PreviewRequest({
  target,
  offset,
  onReady,
  onRetry,
}: {
  target: FileContentTarget
  offset: number
  onReady: (nextOffset?: number) => void
  onRetry: () => void
}) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const client = useQueryClient()
  const controller = useRef<AbortController | null>(null)
  const [data, setData] = useState<PreviewData>()
  const [error, setError] = useState<string>()
  const { file, version } = target

  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    let objectUrl: string | undefined
    const read = async () => {
      try {
        const kind = version.previewKind
        const ranged = kind === "text" && version.bytes > 0
        const range = ranged
          ? `bytes=${offset}-${Math.min(offset + textPageBytes, version.bytes) - 1}`
          : kind === "audio" || kind === "video" || kind === "pdf"
            ? "bytes=0-0"
            : undefined
        const response = await contentRequest(
          { file, version },
          "inline",
          request.signal,
          locale,
          range
        )
        if (request.signal.aborted) return
        if (kind === "text") {
          const bytes = new Uint8Array(await response.data.arrayBuffer())
          if (request.signal.aborted) return
          const end =
            offset + bytes.length >= version.bytes
              ? bytes.length
              : completeUtf8Prefix(bytes)
          const text = new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(0, end)
          )
          setData({ text })
          onReady(offset + end < version.bytes ? offset + end : undefined)
        } else if (kind === "image") {
          objectUrl = URL.createObjectURL(response.data)
          setData({ url: objectUrl })
          onReady()
        } else {
          // 原生媒体和 PDF 后续按需 Range；预检仅读一个字节，不能先下载整个私有文件。
          setData({
            url: getGetFileVersionContentUrl(
              file.organizationId,
              file.id,
              version.id,
              { disposition: "inline" }
            ),
          })
          onReady()
        }
      } catch (failure) {
        if (request.signal.aborted) return
        setError(fileRequestErrorMessage(failure, t("files:previewReadFailed")))
        if (fileRequestIsDenied(failure))
          void client.invalidateQueries({
            queryKey: organizationKeys.access(file.organizationId),
          })
      }
    }
    void read()
    return () => {
      request.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file, version, offset, locale, client, onReady, t])

  const nativeFailure = async () => {
    const signal = controller.current!.signal
    setData(undefined)
    try {
      await contentRequest(
        target,
        "inline",
        signal,
        locale,
        version.bytes > 0 ? "bytes=0-0" : undefined
      )
      if (!signal.aborted) setError(t("files:previewBrowserUnsupported"))
    } catch (failure) {
      if (signal.aborted) return
      setError(fileRequestErrorMessage(failure, t("files:previewReadFailed")))
      if (fileRequestIsDenied(failure))
        void client.invalidateQueries({
          queryKey: organizationKeys.access(file.organizationId),
        })
    }
  }

  if (error) return <ErrorState message={error} onRetry={onRetry} />
  if (!data) return <LoadingState />
  if ("text" in data)
    return (
      <pre
        role="region"
        tabIndex={0}
        aria-label={t("files:textContent")}
        className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-4 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap"
      >
        {data.text || t("files:emptyText")}
      </pre>
    )
  if (version.previewKind === "image")
    return (
      <img
        src={data.url}
        alt={file.name}
        className="max-h-[70vh] max-w-full object-contain"
        onError={() => void nativeFailure()}
      />
    )
  if (version.previewKind === "audio")
    return (
      <audio
        src={data.url}
        controls
        aria-label={file.name}
        className="w-full"
        onError={() => void nativeFailure()}
      />
    )
  if (version.previewKind === "video")
    return (
      <video
        src={data.url}
        controls
        aria-label={file.name}
        className="max-h-[70vh] w-full"
        onError={() => void nativeFailure()}
      />
    )
  return (
    <iframe
      src={data.url}
      title={file.name}
      className="h-[70vh] w-full rounded-md border"
      onError={() => void nativeFailure()}
    />
  )
}
