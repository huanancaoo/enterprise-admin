import assert from "node:assert/strict"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { test, vi } from "vitest"
import { Markdown } from "../components/markdown"

vi.mock("fumadocs-ui/components/dynamic-codeblock", () => ({
  DynamicCodeBlock: ({ lang, code }: { lang: string; code: string }) =>
    createElement("pre", { "data-language": lang }, code),
}))

test("Markdown renders Chinese, links and GFM tables synchronously with word animation", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: "中文说明 [文档](/docs)\n\n| 名称 | 值 |\n| --- | --- |\n| 项目 | 示例 |",
    })
  )

  assert.match(html, /中文说明/)
  assert.match(html, /href="\/docs"/)
  assert.match(html, /animate-fd-fade-in/)
  assert.match(html, /<table>/)
  assert.match(html, /<thead>/)
  assert.match(html, /<tbody>/)
  assert.doesNotMatch(html, /class="invisible"/)
})

test("Markdown preserves code content and language mapping without animating code", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: "```mdx\n# 中文标题\n\n```\n\n```ts\nconst value = 1\n```\n\n```\nplain text\n```",
    })
  )

  assert.match(html, /<pre data-language="md"># 中文标题<\/pre>/)
  assert.match(html, /<pre data-language="ts">const value = 1<\/pre>/)
  assert.match(html, /<pre data-language="text">plain text<\/pre>/)
  for (const [codeBlock] of html.matchAll(/<pre\b[^>]*>[\s\S]*?<\/pre>/g)) {
    assert.doesNotMatch(codeBlock, /animate-fd-fade-in/)
  }
})

test("Markdown keeps ordinary image elements instead of the docs image component", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, { text: "![图片说明](/example.png)" })
  )

  assert.match(html, /<img src="\/example.png" alt="图片说明"\/>/)
  assert.doesNotMatch(html, /sizes=/)
})

test("Markdown renders each streamed text version immediately", () => {
  for (const text of ["初始", "初始 回答", "最终答案"]) {
    const html = renderToStaticMarkup(createElement(Markdown, { text }))

    for (const word of text.split(" ")) assert.ok(html.includes(word))
    assert.doesNotMatch(html, /class="invisible"/)
  }
})
