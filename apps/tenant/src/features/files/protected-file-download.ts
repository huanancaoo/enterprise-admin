import {
  getFileVersionContent,
  requestLanguageHeader,
} from "@workspace/api-client"
import type {
  FileVersionReference,
  SupportedLocale,
} from "@workspace/contracts"
import { parse as parseContentDisposition } from "content-disposition"

export async function downloadProtectedFile(
  organizationId: string,
  reference: FileVersionReference,
  signal: AbortSignal,
  requestLanguage: SupportedLocale
): Promise<void> {
  const response = await getFileVersionContent(
    organizationId,
    reference.fileId,
    reference.versionId,
    { disposition: "attachment" },
    undefined,
    { signal, headers: { [requestLanguageHeader]: requestLanguage } }
  )
  // 内容读回后仍须遵守原入口的授权范围；迟到响应不能启动浏览器下载。
  signal.throwIfAborted()
  // 文件名只采用受保护响应，避免沿用页面缓存中的改名前名称。
  const filename = parseContentDisposition(
    response.headers.get("content-disposition") ?? ""
  ).parameters.filename
  if (!filename) throw new Error("Missing authorized download filename")
  const url = URL.createObjectURL(response.data)
  try {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
  } finally {
    // 浏览器在此次触发后消费 URL；下一任务再释放，触发失败也不遗留临时内容。
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
