import { organizations } from "@workspace/mocks"
import { InvitationDirectory } from "./invitation-directory"

export function InvitationsStory({
  actorRole = "owner",
}: {
  actorRole?: string
}) {
  // 使用正式目录和原生客户端；身份、授权与 SMTP 持久化由真实浏览器链路证明。
  return (
    <main className="mx-auto max-w-4xl p-6">
      <InvitationDirectory
        organizationId={organizations[0].id}
        actorRole={actorRole}
      />
    </main>
  )
}
