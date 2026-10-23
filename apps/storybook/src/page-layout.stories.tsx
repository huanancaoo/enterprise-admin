import { lazy, useState, type ComponentType } from "react"
import { useTranslation } from "react-i18next"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import {
  AdminPage,
  AppShell,
  ErrorState,
  PermissionDeniedState,
  WorkspacePage,
} from "@workspace/admin"
import { Button } from "@workspace/ui/components/button"

function LayoutExample({ workspace = false }: { workspace?: boolean }) {
  const { t } = useTranslation("common")
  const [state, setState] = useState<"ready" | "error" | "denied">("ready")
  const Page = workspace ? WorkspacePage : AdminPage
  return (
    <AppShell
      layout={workspace ? "workspace" : "page"}
      breadcrumb={<span>布局验收</span>}
      sidebar={{
        teamSwitcher: {
          teams: [{ id: "test", name: "示例组织" }],
          value: "test",
          label: "组织",
          onSelect: fn(),
        },
        navigation: [{ label: "主导航", items: [{ title: "示例页面" }] }],
        user: {
          user: { name: "测试用户", email: "test@example.com" },
          accountMenu: () => null,
          signOutMenu: () => null,
          onPersonalSettings: fn(),
        },
      }}
    >
      <Page
        title={
          state === "ready"
            ? "已授权实体"
            : state === "error"
              ? t("errorTitle")
              : t("permissionDenied")
        }
        actions={
          state === "ready" && (
            <>
              <Button onClick={() => setState("error")}>模拟失败</Button>
              <Button onClick={() => setState("denied")}>撤回访问</Button>
            </>
          )
        }
      >
        {state === "ready" ? (
          <div className="min-w-0 space-y-4 p-4">
            {Array.from({ length: 30 }, (_, i) => (
              <p key={i}>业务内容 {i + 1}</p>
            ))}
          </div>
        ) : state === "error" ? (
          <ErrorState onRetry={() => setState("ready")} />
        ) : (
          <PermissionDeniedState />
        )}
      </Page>
    </AppShell>
  )
}
const meta = {
  title: "Admin/Page layout",
  component: LayoutExample,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LayoutExample>
export default meta
type Story = StoryObj<typeof meta>

export const TitleAndAccessBoundary: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const doc = canvasElement.ownerDocument
    await waitFor(() => expect(doc.title).toBe("已授权实体"))
    await expect(canvas.getAllByRole("main")).toHaveLength(1)
    await expect(canvas.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    await userEvent.click(canvas.getByRole("button", { name: "模拟失败" }))
    await waitFor(() => expect(doc.title).toBe("加载失败"))
    await expect(canvas.queryByText("业务内容 1", { exact: true })).toBeNull()
    await userEvent.click(canvas.getByRole("button", { name: "重试" }))
    await userEvent.click(canvas.getByRole("button", { name: "撤回访问" }))
    await waitFor(() => expect(doc.title).toBe("无权访问"))
    await expect(canvas.queryByText("已授权实体")).toBeNull()
    await expect(canvas.queryByRole("button", { name: "模拟失败" })).toBeNull()
    await expect(
      canvasElement.querySelector('[data-slot="sidebar-trigger"]')
    ).toBeVisible()
  },
}

export const WorkspaceScroll: Story = {
  args: { workspace: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const content = canvasElement.querySelector<HTMLElement>(
      '[data-slot="workspace-content"]'
    )!
    const heading = canvas.getByRole("heading", { level: 1 })
    const top = heading.getBoundingClientRect().top
    content.scrollTop = content.scrollHeight
    await waitFor(() => expect(content.scrollTop).toBeGreaterThan(0))
    await expect(heading.getBoundingClientRect().top).toBe(top)
    await expect(
      canvasElement.ownerDocument.documentElement.scrollHeight
    ).toBeLessThanOrEqual(window.innerHeight)
    await userEvent.click(canvas.getByRole("button", { name: "模拟失败" }))
    await expect(
      canvasElement.querySelector('[data-slot="sidebar-trigger"]')
    ).toBeVisible()
    await expect(canvas.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  },
}

export const ReadingWidthAndRTL: Story = {
  globals: { locale: "ar" },
  render: () => (
    <main>
      <AdminPage
        title={"عنوان طويل ".repeat(16)}
        contentWidth="reading"
        back={<Button variant="ghost">العودة</Button>}
        actions={<Button>حفظ</Button>}
      >
        <p>{"محتوى طويل ".repeat(80)}</p>
      </AdminPage>
    </main>
  ),
  play: async ({ canvasElement }) => {
    const content = canvasElement.querySelector<HTMLElement>(
      '[data-slot="page-content"]'
    )!
    const heading = within(canvasElement).getByRole("heading", { level: 1 })
    await expect(getComputedStyle(content).direction).toBe("rtl")
    await expect(content.getBoundingClientRect().width).toBeLessThanOrEqual(896)
    await expect(heading.getBoundingClientRect().right).toBeCloseTo(
      content.getBoundingClientRect().right,
      0
    )
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(
      canvasElement.clientWidth
    )
  },
}

function PendingContentExample({ workspace = false }: { workspace?: boolean }) {
  const [{ Content, complete }] = useState(() => {
    let complete!: () => void
    const promise = new Promise<{ default: ComponentType }>((resolve) => {
      complete = () => resolve({ default: () => <p>正文已就绪</p> })
    })
    return {
      Content: lazy(() => promise),
      complete,
    }
  })
  const Page = workspace ? WorkspacePage : AdminPage
  return (
    <main className="flex h-svh flex-col">
      <Page
        title="岗位管理"
        back={<Button variant="ghost">返回列表</Button>}
        actions={<Button onClick={complete}>完成正文加载</Button>}
      >
        <Content />
      </Page>
    </main>
  )
}

const verifyPendingHeader: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  const heading = canvas.getByRole("heading", { name: "岗位管理", level: 1 })
  const back = canvas.getByRole("button", { name: "返回列表" })
  await expect(canvas.getByRole("status")).toHaveAttribute("aria-busy", "true")
  await expect(heading).toBeVisible()
  await expect(back).toBeVisible()
  await waitFor(() =>
    expect(canvasElement.ownerDocument.title).toBe("岗位管理")
  )
  await expect(canvas.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  await userEvent.click(canvas.getByRole("button", { name: "完成正文加载" }))
  await expect(await canvas.findByText("正文已就绪")).toBeVisible()
  await expect(canvas.queryByRole("status")).toBeNull()
  await expect(canvas.getByRole("heading", { level: 1 })).toBe(heading)
  await expect(canvas.getByRole("button", { name: "返回列表" })).toBe(back)
  await expect(canvasElement.ownerDocument.title).toBe("岗位管理")
}

export const PageHeaderDuringContentLoading: Story = {
  render: () => <PendingContentExample />,
  play: verifyPendingHeader,
}

export const WorkspaceHeaderDuringContentLoading: Story = {
  render: () => <PendingContentExample workspace />,
  play: verifyPendingHeader,
}
