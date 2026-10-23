import type { ReactNode } from "react"

export function FileActivityLayout({
  children,
  activity,
  contentId,
}: {
  children: ReactNode
  activity: ReactNode
  contentId?: string
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        id={contentId}
        tabIndex={contentId ? -1 : undefined}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
      >
        {children}
      </div>
      {/* 工作区内的记录独立滚动，不能把文件浏览区挤到零高；普通页面仍按内容自然展开。 */}
      <div className="max-h-1/3 shrink-0 overflow-y-auto">{activity}</div>
    </div>
  )
}
