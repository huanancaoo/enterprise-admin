"use client"

import { lazy, Suspense } from "react"
import { LoadingState } from "../page"
import type { RichTextEditorProps } from "./rich-text-editor"

const Editor = lazy(() =>
  import("./rich-text-editor").then((module) => ({
    default: module.RichTextEditor,
  }))
)

// 编辑器加载不应卸载所在表单，也不能阻挡页面标题和导航。
export function RichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense fallback={<LoadingState />}>
      <Editor {...props} />
    </Suspense>
  )
}
