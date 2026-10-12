import { WebhooksSettings } from "./webhooks-settings"
import { useParams } from "@tanstack/react-router"
import { AccessCredentialsSettings } from "./access-credentials"

export function IntegrationsRoute() {
  const { organizationId } = useParams({
    from: "/app/integrations/$organizationId",
  })
  return (
    <>
      <AccessCredentialsSettings organizationId={organizationId} />
      <WebhooksSettings organizationId={organizationId} />
    </>
  )
}
