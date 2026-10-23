import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import { GitHubReleases } from "../components/github-releases"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test("认证读取 GitHub 发布说明，只展示正式发布且不输出凭据", async () => {
  vi.stubEnv("GITHUB_TOKEN", "release-reader-token")
  const request = vi.fn<typeof fetch>(async (_url, options) => {
    if (
      new Headers(options?.headers).get("Authorization") !==
      "Bearer release-reader-token"
    )
      return new Response(null, { status: 403 })
    return Response.json([
      {
        id: 1,
        name: "Release 1",
        tag_name: "v1",
        html_url:
          "https://github.com/huanancaoo/enterprise-admin/releases/tag/v1",
        published_at: "2026-10-23T00:00:00Z",
        body: "Published changes",
        draft: false,
        prerelease: false,
      },
      { id: 2, name: "Unpublished draft", draft: true, prerelease: false },
      { id: 3, name: "Preview release", draft: false, prerelease: true },
    ])
  })
  vi.stubGlobal("fetch", request)

  const html = renderToStaticMarkup(await GitHubReleases())
  expect(html).toContain("Release 1")
  expect(html).toContain("Published changes")
  expect(html).not.toContain("Unpublished draft")
  expect(html).not.toContain("Preview release")
  expect(html).not.toContain("release-reader-token")
})

test("GitHub 读取失败保持失败，不显示为尚无发布记录", async () => {
  vi.stubEnv("GITHUB_TOKEN", "release-reader-token")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 500 }))
  )
  await expect(GitHubReleases()).rejects.toThrow(
    "GitHub releases request failed: 500"
  )
})
