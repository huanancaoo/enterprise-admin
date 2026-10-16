import { test } from "vitest"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { checkContent } from "../scripts/check-content.mjs"

const frontmatter = (locale: "en-US" | "zh-CN") => `---
title: Example
description: Example page
category: guides
tags:
  - example
locale: ${locale}
status: published
---
`

function checkPagePair(
  source: (locale: "en-US" | "zh-CN") => string,
  extraFiles: string[] = []
) {
  const root = mkdtempSync(join(tmpdir(), "docs-content-"))
  try {
    writeFileSync(join(root, "index.mdx"), source("en-US"))
    writeFileSync(join(root, "index.zh-CN.mdx"), source("zh-CN"))
    for (const file of extraFiles) writeFileSync(join(root, file), "target")
    return checkContent(root).errors
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("content checks require a zh-CN pair, published frontmatter, and relative links", () => {
  const root = mkdtempSync(join(tmpdir(), "docs-content-"))
  try {
    mkdirSync(join(root, "guides"), { recursive: true })
    writeFileSync(
      join(root, "guides", "index.mdx"),
      `${frontmatter("en-US")}\nSee [missing](./gone.mdx).\n`
    )
    assert.deepEqual(checkContent(root).errors, [
      "guides/index.mdx: missing zh-CN translation",
      "guides/index.mdx: broken link ./gone.mdx",
    ])

    writeFileSync(
      join(root, "guides", "index.zh-CN.mdx"),
      `---
title: 示例
description: 示例页
category: guides
tags:
  - example
locale: en-US
status: draft
---
`
    )
    assert.deepEqual(checkContent(root).errors, [
      "guides/index.mdx: broken link ./gone.mdx",
      "guides/index.zh-CN.mdx: locale en-US does not match file",
      "guides/index.zh-CN.mdx: status must be published",
    ])

    writeFileSync(join(root, "guides", "gone.mdx"), `${frontmatter("en-US")}\n`)
    writeFileSync(
      join(root, "guides", "gone.zh-CN.mdx"),
      `${frontmatter("zh-CN")}\n`
    )
    writeFileSync(
      join(root, "guides", "index.mdx"),
      `${frontmatter("en-US")}\nSee [target](./gone.mdx).\n`
    )
    writeFileSync(
      join(root, "guides", "index.zh-CN.mdx"),
      `${frontmatter("zh-CN")}\n`
    )
    assert.deepEqual(checkContent(root).errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("content checks parse YAML comments, quoted values, and multiline strings", () => {
  const errors = checkPagePair(
    (locale) => `---
title: "Example # title"
description: |
  First line
  Second line
category: guides
tags: [example, "with # character"]
locale: ${locale}
status: published # ready
---
`
  )
  assert.deepEqual(errors, [])
})

test("content checks reject empty YAML tag arrays", () => {
  const errors = checkPagePair((locale) =>
    frontmatter(locale).replace("tags:\n  - example", "tags: []")
  )
  assert.deepEqual(errors, [
    "index.mdx: missing tags",
    "index.zh-CN.mdx: missing tags",
  ])
})

test("content checks retain required-field checks for empty YAML values", () => {
  assert.deepEqual(
    checkPagePair((locale) =>
      frontmatter(locale).replace("title: Example", "title:")
    ),
    ["index.mdx: missing title", "index.zh-CN.mdx: missing title"]
  )
})

test.each([
  ["malformed YAML", "title: [unterminated"],
  ["duplicate keys", "title: First\ntitle: Second"],
  ["non-object metadata", "- example"],
])("content checks report %s per file", (_name, metadata) => {
  assert.deepEqual(
    checkPagePair(() => `---\n${metadata}\n---\n`),
    ["index.mdx: invalid frontmatter", "index.zh-CN.mdx: invalid frontmatter"]
  )
})

test("content checks still require frontmatter", () => {
  assert.deepEqual(
    checkPagePair(() => "No frontmatter\n"),
    ["index.mdx: missing frontmatter", "index.zh-CN.mdx: missing frontmatter"]
  )
})

test("content checks report invalid MDX per file", () => {
  assert.deepEqual(
    checkPagePair((locale) => frontmatter(locale) + "\n<Callout>\n"),
    ["index.mdx: invalid MDX", "index.zh-CN.mdx: invalid MDX"]
  )
})

test("content checks ignore link examples in code and MDX expressions", () => {
  const body = `
[existing](./target.txt)

\`[inline example](./inline-example.mdx)\`

\`\`\`md
[fenced example](./fenced-example.mdx)
\`\`\`

{"[expression example](./expression-example.mdx)"}

<Callout title="[attribute example](./attribute-example.mdx)">
  [nested link](./target.txt)
</Callout>
`
  assert.deepEqual(
    checkPagePair((locale) => frontmatter(locale) + body, ["target.txt"]),
    []
  )
})

test("content checks resolve used link and image references", () => {
  const body = `
[missing][Guide]
![missing image][Picture]
![inline image](./inline.png)
[existing][Repeated]

[guide]: ./gone.mdx "Title"
[picture]: ./missing.png
[unused]: ./unused.mdx
[repeated]: ./target.txt
[Repeated]: ./ignored.mdx
`
  assert.deepEqual(
    checkPagePair((locale) => frontmatter(locale) + body, ["target.txt"]),
    [
      "index.mdx: broken link ./gone.mdx",
      "index.mdx: broken link ./missing.png",
      "index.mdx: broken link ./inline.png",
      "index.zh-CN.mdx: broken link ./gone.mdx",
      "index.zh-CN.mdx: broken link ./missing.png",
      "index.zh-CN.mdx: broken link ./inline.png",
    ]
  )
})

test("content checks parse link titles and encoded local filenames", () => {
  const body = `
[guide](<./guide (v2).txt> "Guide title")
[encoded guide](./guide%20(v2).txt)
`
  assert.deepEqual(
    checkPagePair((locale) => frontmatter(locale) + body, ["guide (v2).txt"]),
    []
  )
})
