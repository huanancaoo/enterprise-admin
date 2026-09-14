import { MembersTable } from "@/components/members-table"

export function App() {
  return (
    <div className="flex min-h-svh flex-col p-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-medium">Members</h1>
          <p className="text-sm text-muted-foreground">
            Search, filter, sort, select, hide columns, paginate. Press{" "}
            <kbd>d</kbd> to toggle dark mode.
          </p>
        </header>
        <MembersTable />
      </div>
    </div>
  )
}
