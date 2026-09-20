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
