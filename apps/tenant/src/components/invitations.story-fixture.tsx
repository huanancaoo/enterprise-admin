import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { organizations } from "@workspace/mocks"
import { InvitationDirectory } from "./invitation-directory"

export function InvitationsStory({
  actorRole = "owner",
}: {
  actorRole?: string
}) {
  const [router] = useState(() => {
    const root = createRootRoute()
    const invitations = createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => (
        <main className="mx-auto max-w-4xl p-6">
          <InvitationDirectory
            organizationId={organizations[0].id}
            actorRole={actorRole}
          />
        </main>
      ),
    })
    const task = createRoute({
      getParentRoute: () => root,
      path: "/app/tasks/$organizationId",
      component: TaskDestination,
    })
    return createRouter({
      routeTree: root.addChildren([invitations, task]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    })
  })
  return <RouterProvider router={router} />
}

function TaskDestination() {
  const { t } = useTranslation("tasks")
  return (
    <main>
      <h1>{t("title")}</h1>
    </main>
  )
}
