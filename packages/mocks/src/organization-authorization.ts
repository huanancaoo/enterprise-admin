import { http, HttpResponse } from "msw"

export function createOrganizationAuthorizationScenario() {
  let version = 1
  let rejectNext = false
  let held:
    | {
        started: () => void
        wait: Promise<void>
        finished: () => void
      }
    | undefined
  const releases = new Set<() => void>()
  return {
    handlers: [
      http.get(
        "*/api/v1/organizations/:organizationId/access",
        async ({ params }) => {
          const observedVersion = version
          const rejected = rejectNext
          rejectNext = false
          const pending = held
          held = undefined
          pending?.started()
          await pending?.wait
          pending?.finished()
          return rejected
            ? HttpResponse.json(
                {
                  code: "FORBIDDEN",
                  message: "Authorization denied",
                  requestId: "storybook-authorization",
                  locale: "en-US",
                },
                { status: 403 }
              )
            : HttpResponse.json({
                organizationId: params.organizationId,
                status: "ACTIVE",
                authorizationVersion: observedVersion,
                effectiveLocale: "en-US",
                effectiveLocaleSource: "organization",
              })
        }
      ),
    ],
    setVersion: (next: number) => {
      version = next
    },
    rejectNext: () => {
      rejectNext = true
    },
    holdNext: () => {
      let start!: () => void
      let release!: () => void
      let finish!: () => void
      const started = new Promise<void>((resolve) => (start = resolve))
      const wait = new Promise<void>((resolve) => (release = resolve))
      const finished = new Promise<void>((resolve) => (finish = resolve))
      releases.add(release)
      held = { started: start, wait, finished: finish }
      return {
        started,
        finished,
        release: () => {
          release()
          releases.delete(release)
        },
      }
    },
    reset: () => {
      for (const release of releases) release()
      releases.clear()
      held = undefined
      version = 1
      rejectNext = false
    },
  }
}
