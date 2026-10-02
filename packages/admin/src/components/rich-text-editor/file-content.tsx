"use client"

import * as React from "react"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import {
  FileVersionReferenceSchema,
  type FileVersionReference,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { useTranslation } from "react-i18next"

import { FileContentContext } from "./file-context"

function useFileContent() {
  const ports = React.useContext(FileContentContext)
  if (!ports) throw new Error("File content provider is required")
  return ports
}

function referenceFromNode(node: NodeViewProps["node"]): FileVersionReference {
  return FileVersionReferenceSchema.parse({
    fileId: node.attrs.fileId,
    versionId: node.attrs.versionId,
  })
}

type ImageState = {
  key: string
  src?: string
  error?: string
}

export function FileImageView({ node }: NodeViewProps) {
  const { t } = useTranslation("common")
  const ports = useFileContent()
  const currentPorts = React.useEffectEvent(() => ports)
  const fileId = String(node.attrs.fileId)
  const versionId = String(node.attrs.versionId)
  const key = JSON.stringify([ports.contentScopeKey, fileId, versionId])
  const [state, setState] = React.useState<ImageState>()

  React.useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    const { resolveImage, getFileErrorMessage } = currentPorts()
    void (async () => {
      try {
        const reference = FileVersionReferenceSchema.parse({
          fileId,
          versionId,
        })
        const blob = await resolveImage(reference, controller.signal)
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setState({ key, src: objectUrl })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ key, error: getFileErrorMessage(error) })
      }
    })()
    return () => {
      // 私有内容不能跨身份、组织或授权修订复用，也不能在卸载后创建新 URL。
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileId, versionId, key])

  const current = state?.key === key ? state : undefined
  return (
    <NodeViewWrapper as="figure" contentEditable={false} data-file-image="">
      {current?.src ? (
        <img src={current.src} alt={String(node.attrs.alt ?? "")} />
      ) : current?.error ? (
        <figcaption>
          <span role="alert">
            {t("imageLoadFailed", { reason: current.error })}
          </span>
        </figcaption>
      ) : (
        <figcaption>
          <span role="status">{t("imageLoading")}</span>
        </figcaption>
      )}
    </NodeViewWrapper>
  )
}

export function FileAttachmentView({ node }: NodeViewProps) {
  const { t } = useTranslation("common")
  const ports = useFileContent()
  const [state, setState] = React.useState<{
    key: string
    pending: boolean
    error?: string
  }>()
  const key = JSON.stringify([
    ports.contentScopeKey,
    node.attrs.fileId,
    node.attrs.versionId,
  ])
  const current = state?.key === key ? state : undefined
  const name = String(node.attrs.label)
  return (
    <NodeViewWrapper contentEditable={false} data-file-attachment="">
      <Button
        type="button"
        variant="link"
        disabled={current?.pending}
        onClick={() => {
          setState({ key, pending: true })
          void (async () => {
            try {
              await ports.downloadFile(referenceFromNode(node))
              setState({ key, pending: false })
            } catch (error) {
              setState({
                key,
                pending: false,
                error: ports.getFileErrorMessage(error),
              })
            }
          })()
        }}
      >
        {t("fileDownload", { name })}
      </Button>
      {current?.error && (
        <p role="alert">{t("fileDownloadFailed", { reason: current.error })}</p>
      )}
    </NodeViewWrapper>
  )
}
