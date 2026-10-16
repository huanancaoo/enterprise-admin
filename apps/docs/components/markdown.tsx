import remarkGfm from "remark-gfm"
import { createMarkdownRenderer } from "fumadocs-core/content/md"
import {
  Children,
  type ComponentProps,
  type ReactElement,
  Suspense,
  useDeferredValue,
} from "react"
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock"
import defaultMdxComponents from "fumadocs-ui/mdx"
import { visit } from "unist-util-visit"
import type { ElementContent, Root, RootContent } from "hast"

export function rehypeWrapWords() {
  return (tree: Root) => {
    visit(tree, ["text", "element"], (node, index, parent) => {
      if (node.type === "element" && node.tagName === "pre") return "skip"
      if (node.type !== "text" || !parent || index === undefined) return

      const words = node.value.split(/(?=\s)/)

      // Create new span nodes for each word and whitespace
      const newNodes: ElementContent[] = words.flatMap((word) => {
        if (word.length === 0) return []

        return {
          type: "element",
          tagName: "span",
          properties: {
            class: "animate-fd-fade-in",
          },
          children: [{ type: "text", value: word }],
        }
      })

      Object.assign(node, {
        type: "element",
        tagName: "span",
        properties: {},
        children: newNodes,
      } satisfies RootContent)
      return "skip"
    })
  }
}

function Pre(props: ComponentProps<"pre">) {
  const code = Children.only(props.children) as ReactElement
  const codeProps = code.props as ComponentProps<"code">
  const content = codeProps.children
  if (typeof content !== "string") return null

  let lang =
    codeProps.className
      ?.split(" ")
      .find((v) => v.startsWith("language-"))
      ?.slice("language-".length) ?? "text"

  if (lang === "mdx") lang = "md"

  return <DynamicCodeBlock lang={lang} code={content.trimEnd()} />
}

// 当前插件均为同步处理；异步模式会缓存流式回答的每个中间文本。
const { Markdown: Renderer } = createMarkdownRenderer({
  remarkPlugins: [remarkGfm],
  rehypePlugins: [rehypeWrapWords],
})
const components = {
  ...defaultMdxComponents,
  pre: Pre,
  img: "img",
}

export function Markdown({ text }: { text: string }) {
  const deferredText = useDeferredValue(text)

  return (
    <Suspense fallback={<p className="invisible">{text}</p>}>
      <Renderer components={components}>{deferredText}</Renderer>
    </Suspense>
  )
}
