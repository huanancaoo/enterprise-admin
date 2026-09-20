import { test } from "vitest"
import assert from "node:assert/strict"
import { getMDXComponents } from "../components/mdx"

test("MDX components expose GitHubReleases and Mermaid", () => {
  const components = getMDXComponents()
  assert.equal(typeof components.GitHubReleases, "function")
  assert.equal(typeof components.Mermaid, "function")
})

test("MDX components keep Fumadocs defaults when merging", () => {
  const components = getMDXComponents()
  assert.ok(components.pre)
})
