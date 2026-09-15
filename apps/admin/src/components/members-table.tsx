import * as React from "react"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ChevronDownIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@workspace/ui/components/dropdown-menu"
import {
  DataTable,
  DataTableColumnHeader,
  createDataTableColumnHelper,
  createDataTableRowControlsColumn,
  createDataTableSelectColumn,
} from "@workspace/admin"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"

type MemberStatus = "active" | "invited" | "suspended"
type MemberRole = "admin" | "editor" | "viewer"

type Member = {
  id: string
  name: string
  email: string
  role: MemberRole
  status: MemberStatus
  department: string
  lastActive: string
}

const FIRST_NAMES = [
  "Ava",
  "Noah",
  "Mia",
  "Liam",
  "Zoe",
  "Owen",
  "Ivy",
  "Eli",
  "Nora",
  "Kai",
] as const

const LAST_NAMES = [
  "Chen",
  "Patel",
  "Nguyen",
  "Garcia",
  "Kim",
  "Silva",
  "Berg",
  "Okoye",
  "Sato",
  "Walsh",
] as const

const DEPARTMENTS = [
  "Engineering",
  "Product",
  "Design",
  "Operations",
  "Finance",
] as const

const ROLES: MemberRole[] = ["admin", "editor", "viewer"]
const STATUSES: MemberStatus[] = ["active", "invited", "suspended"]

const members: Member[] = Array.from({ length: 57 }, (_, index) => {
  const firstName = FIRST_NAMES[index % FIRST_NAMES.length]
  const lastName = LAST_NAMES[(index * 3) % LAST_NAMES.length]
  const day = String((index % 28) + 1).padStart(2, "0")

  return {
    id: String(index + 1),
    name: `${firstName} ${lastName}`,
    email: `${firstName}.${lastName}${index + 1}@acme.com`.toLowerCase(),
    role: ROLES[index % ROLES.length],
    status: STATUSES[index % STATUSES.length],
    department: DEPARTMENTS[index % DEPARTMENTS.length],
    lastActive: `2026-08-${day}`,
  }
})

const statusOptions = [
  { label: "Active", value: "active", icon: CircleCheckIcon },
  { label: "Invited", value: "invited", icon: CircleDashedIcon },
  { label: "Suspended", value: "suspended", icon: CircleAlertIcon },
]

const roleOptions = [
  { label: "Admin", value: "admin" },
  { label: "Editor", value: "editor" },
  { label: "Viewer", value: "viewer" },
]

const statusBadgeVariant = {
  active: "default",
  invited: "secondary",
  suspended: "destructive",
} as const

const columnHelper = createDataTableColumnHelper<Member>()

const columns = columnHelper.columns([
  createDataTableRowControlsColumn<Member>(),
  createDataTableSelectColumn<Member>(),
  columnHelper.accessor("name", {
    header: ({ header }) => (
      <DataTableColumnHeader header={header} title="Name" />
    ),
    meta: { label: "Name" },
  }),
  columnHelper.accessor("email", {
    size: 260,
    header: ({ header }) => (
      <DataTableColumnHeader header={header} title="Email" />
    ),
    meta: { label: "Email" },
  }),
  columnHelper.accessor("role", {
    header: ({ header }) => (
      <DataTableColumnHeader header={header} title="Role" />
    ),
    cell: ({ getValue }) => (
      <Badge variant="outline" className="capitalize">
        {getValue()}
      </Badge>
    ),
    meta: { label: "Role", facetOptions: roleOptions },
  }),
  columnHelper.accessor("status", {
    header: ({ header }) => (
      <DataTableColumnHeader header={header} title="Status" />
    ),
    cell: ({ getValue }) => {
      const status = getValue()
      return (
        <Badge variant={statusBadgeVariant[status]} className="capitalize">
          {status}
        </Badge>
      )
    },
    meta: { label: "Status", facetOptions: statusOptions },
  }),
  columnHelper.accessor("department", {
    header: ({ header }) => (
      <DataTableColumnHeader header={header} title="Department" />
    ),
    meta: { label: "Department" },
  }),
  columnHelper.accessor("lastActive", {
    header: ({ header }) => (
      <DataTableColumnHeader header={header} title="Last active" />
    ),
    meta: { label: "Last active" },
  }),
])

export function MembersTable() {
  const [isLoading, setIsLoading] = React.useState(false)
  const [memberData, setMemberData] = React.useState(members)

  function updateSelectedStatus(ids: Set<string>, status: MemberStatus) {
    setMemberData((current) =>
      current.map((member) =>
        ids.has(member.id) ? { ...member, status } : member
      )
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Label
        htmlFor="members-table-loading"
        className="ms-auto text-muted-foreground"
      >
        <Switch
          id="members-table-loading"
          checked={isLoading}
          onCheckedChange={setIsLoading}
          size="sm"
        />
        Loading
      </Label>
      <DataTable
        columns={columns}
        data={memberData}
        getRowId={(row) => row.id}
        isLoading={isLoading}
        searchPlaceholder="Search members..."
        getRowCanExpand={() => true}
        columnResizeMode="onChange"
        defaultColumn={{ size: 180, minSize: 48 }}
        initialState={{
          columnPinning: { start: ["row-controls", "select", "name"], end: [] },
        }}
        renderSelectionActions={(rows) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" disabled={isLoading} />
              }
            >
              Bulk actions
              <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() =>
                  updateSelectedStatus(
                    new Set(rows.map((row) => row.original.id)),
                    "active"
                  )
                }
              >
                <CircleCheckIcon data-icon="inline-start" aria-hidden="true" />
                Activate
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  updateSelectedStatus(
                    new Set(rows.map((row) => row.original.id)),
                    "suspended"
                  )
                }
              >
                <CircleAlertIcon data-icon="inline-start" aria-hidden="true" />
                Suspend
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        renderExpandedRow={({ original: member }) => (
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="break-all">{member.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Department</dt>
              <dd>{member.department}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last active</dt>
              <dd>{member.lastActive}</dd>
            </div>
          </dl>
        )}
      />
    </div>
  )
}
