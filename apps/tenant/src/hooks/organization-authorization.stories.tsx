import { useId, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within, waitFor } from "storybook/test"
import { createOrganizationAuthorizationScenario } from "@workspace/mocks"
import { useOrganizationAuthorization } from "./use-organization-authorization"

const organizationId = "c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1"
const otherOrganizationId = "d1d1d1d1-1111-4111-8111-d1d1d1d1d1d1"
const userId = "c3c3c3c3-1111-4111-8111-c3c3c3c3c3c3"
const otherUserId = "c4c4c4c4-1111-4111-8111-c4c4c4c4c4c4"
const fixture = createOrganizationAuthorizationScenario()

function Draft({
  authority,
}: {
  authority: NonNullable<
    ReturnType<typeof useOrganizationAuthorization>["data"]
  >
}) {
  const id = useId()
  const [draft, setDraft] = useState("")
  return (
    <div>
      <p>{authority.userId}</p>
      <p>{authority.organizationId}</p>
      <p>Version {authority.authorizationVersion}</p>
      <label htmlFor={id}>Draft</label>
      <input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </div>
  )
}

function Observer(props: Parameters<typeof useOrganizationAuthorization>[0]) {
  const access = useOrganizationAuthorization(props)
  return (
    <section aria-label={props.observation}>
      <button onClick={() => void access.refetch()}>Refresh</button>
      <p role="status">{access.isFetching ? "Refreshing" : "Idle"}</p>
      {access.isError ? (
        <p role="alert">{access.error.message}</p>
      ) : access.isPending ? (
        <p>Loading</p>
      ) : (
        <Draft key={access.data.scopeKey} authority={access.data} />
      )}
    </section>
  )
}

function Observations() {
  const [subject, setSubject] = useState({ organizationId, userId })
  return (
    <div>
      <button
        onClick={() =>
          setSubject({
            ...subject,
            userId: subject.userId === userId ? otherUserId : userId,
          })
        }
      >
        Switch account
      </button>
      <button
        onClick={() =>
          setSubject({
            ...subject,
            organizationId:
              subject.organizationId === organizationId
                ? otherOrganizationId
                : organizationId,
          })
        }
      >
        Switch organization
      </button>
      <Observer {...subject} observation="access-credentials" />
      <Observer {...subject} observation="webhooks" />
    </div>
  )
}

const meta = {
  title: "Admin/Organization authorization observation",
  component: Observations,
  globals: { locale: "en-US" },
  beforeEach: fixture.reset,
  parameters: { msw: { handlers: fixture.handlers } },
} satisfies Meta<typeof Observations>
export default meta
type Story = StoryObj<typeof meta>

export const IndependentRefreshPreservesDraftUntilVersionChanges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const credentials = within(
      canvas.getByRole("region", { name: "access-credentials" })
    )
    const webhooks = within(canvas.getByRole("region", { name: "webhooks" }))
    await credentials.findByText("Version 1")
    await webhooks.findByText("Version 1")
    await userEvent.type(
      credentials.getByRole("textbox", { name: "Draft" }),
      "Credential draft"
    )
    await userEvent.type(
      webhooks.getByRole("textbox", { name: "Draft" }),
      "Webhook draft"
    )

    const refresh = fixture.holdNext()
    await userEvent.click(webhooks.getByRole("button", { name: "Refresh" }))
    await refresh.started
    await expect(webhooks.getByRole("status")).toHaveTextContent("Refreshing")
    await expect(credentials.getByRole("status")).toHaveTextContent("Idle")
    await expect(webhooks.getByRole("textbox")).toHaveValue("Webhook draft")
    refresh.release()
    await waitFor(() =>
      expect(webhooks.getByRole("status")).toHaveTextContent("Idle")
    )
    await expect(webhooks.getByRole("textbox")).toHaveValue("Webhook draft")

    fixture.rejectNext()
    await userEvent.click(webhooks.getByRole("button", { name: "Refresh" }))
    await expect(await webhooks.findByRole("alert")).toHaveTextContent(
      "Authorization denied"
    )
    await expect(credentials.getByRole("textbox")).toHaveValue(
      "Credential draft"
    )

    fixture.setVersion(2)
    await userEvent.click(credentials.getByRole("button", { name: "Refresh" }))
    await credentials.findByText("Version 2")
    await expect(credentials.getByRole("textbox")).toHaveValue("")
  },
}

async function switchSubject(
  canvasElement: HTMLElement,
  kind: "account" | "organization"
) {
  const canvas = within(canvasElement)
  const credentials = within(
    canvas.getByRole("region", { name: "access-credentials" })
  )
  await credentials.findByText("Version 1")
  await within(canvas.getByRole("region", { name: "webhooks" })).findByText(
    "Version 1"
  )
  const switchButton = canvas.getByRole("button", { name: `Switch ${kind}` })
  await userEvent.click(switchButton)
  await credentials.findByText(
    kind === "account" ? otherUserId : otherOrganizationId
  )
  await userEvent.type(credentials.getByRole("textbox"), "Other subject draft")
  await userEvent.click(switchButton)
  await credentials.findByText(kind === "account" ? userId : organizationId)
  // 两个主体都已有同版本缓存，切换时不能靠初始 loading 卸载来碰巧清掉草稿。
  await expect(credentials.getByText("Version 1")).toBeVisible()
  await expect(credentials.getByRole("textbox")).toHaveValue("")
  await waitFor(() => {
    for (const status of canvas.getAllByRole("status"))
      expect(status).toHaveTextContent("Idle")
  })
  await userEvent.type(credentials.getByRole("textbox"), "Old subject draft")
  const stale = fixture.holdNext()
  await userEvent.click(credentials.getByRole("button", { name: "Refresh" }))
  await stale.started
  fixture.setVersion(2)
  await userEvent.click(switchButton)
  await credentials.findByText("Version 2")
  stale.release()
  await stale.finished
  await expect(credentials.getByText("Version 2")).toBeVisible()
  await expect(credentials.getByRole("textbox")).toHaveValue("")
  await expect(
    credentials.getByText(
      kind === "account" ? otherUserId : otherOrganizationId
    )
  ).toBeVisible()
  await expect(
    credentials.queryByText(kind === "account" ? userId : organizationId)
  ).toBeNull()
}

export const AccountSwitchDiscardsLateAuthorization: Story = {
  play: ({ canvasElement }) => switchSubject(canvasElement, "account"),
}

export const OrganizationSwitchDiscardsLateAuthorization: Story = {
  play: ({ canvasElement }) => switchSubject(canvasElement, "organization"),
}
