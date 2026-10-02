import { useCallback } from "react"

export function useBlobImageRef(blob: Blob | undefined) {
  return useCallback(
    (node: HTMLImageElement | null) => {
      if (!node || !blob) return
      const url = URL.createObjectURL(blob)
      node.src = url
      // URL 跟随实际图片节点的提交和释放；私有字节不能在卸载或授权错误后留存。
      return () => {
        node.removeAttribute("src")
        URL.revokeObjectURL(url)
      }
    },
    [blob]
  )
}
