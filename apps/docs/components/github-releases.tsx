import { gitConfig } from "@/lib/shared"

type GitHubRelease = {
  id: number
  name: string | null
  tag_name: string
  html_url: string
  published_at: string | null
  body: string | null
  draft: boolean
  prerelease: boolean
}

export async function GitHubReleases() {
  const response = await fetch(
    `https://api.github.com/repos/${gitConfig.user}/${gitConfig.repo}/releases`,
    {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
    }
  )

  if (!response.ok) {
    throw new Error(`GitHub releases request failed: ${response.status}`)
  }

  const releases = (await response.json()) as GitHubRelease[]
  const published = releases.filter(
    (release) => !release.draft && !release.prerelease
  )

  if (published.length === 0) {
    return <p>No GitHub releases have been published yet.</p>
  }

  return (
    <div className="flex flex-col gap-8">
      {published.map((release) => (
        <article key={release.id} className="border-b pb-6">
          <h2 className="mt-0">
            <a href={release.html_url}>{release.name ?? release.tag_name}</a>
          </h2>
          {release.published_at ? (
            <p className="text-fd-muted-foreground text-sm">
              {release.published_at.slice(0, 10)}
            </p>
          ) : null}
          {release.body ? (
            <pre className="font-sans whitespace-pre-wrap">{release.body}</pre>
          ) : null}
        </article>
      ))}
    </div>
  )
}
