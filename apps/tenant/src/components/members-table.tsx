import { useTranslation } from "react-i18next"
import type { TFunction } from "@workspace/i18n"
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

function createColumns(t: TFunction<["organization", "common", "auth"]>) {
  const statusOptions = [
    {
      label: t("organization:memberStatus_active"),
      value: "active",
      icon: CircleCheckIcon,
    },
    {
      label: t("organization:memberStatus_invited"),
      value: "invited",
      icon: CircleDashedIcon,
    },
    {
      label: t("organization:memberStatus_suspended"),
      value: "suspended",
      icon: CircleAlertIcon,
    },
  ]

  const roleOptions = [
    { label: t("organization:role_admin"), value: "admin" },
    { label: t("organization:role_editor"), value: "editor" },
    { label: t("organization:role_viewer"), value: "viewer" },
  ]

  const statusBadgeVariant = {
    active: "default",
    invited: "secondary",
    suspended: "destructive",
  } as const

  const columnHelper = createDataTableColumnHelper<Member>()

  return columnHelper.columns([
    createDataTableRowControlsColumn<Member>(),
    createDataTableSelectColumn<Member>(),
    columnHelper.accessor("name", {
      header: ({ header }) => (
        <DataTableColumnHeader header={header} title={t("auth:name")} />
      ),
      meta: { label: t("auth:name") },
    }),
    columnHelper.accessor("email", {
      size: 260,
      header: ({ header }) => (
        <DataTableColumnHeader header={header} title={t("auth:email")} />
      ),
      meta: { label: t("auth:email") },
    }),
    columnHelper.accessor("role", {
      header: ({ header }) => (
        <DataTableColumnHeader header={header} title={t("organization:role")} />
      ),
      cell: ({ getValue }) => (
        <Badge variant="outline" className="capitalize">
          {t(`organization:role_${getValue()}`)}
        </Badge>
      ),
      meta: { label: t("organization:role"), facetOptions: roleOptions },
    }),
    columnHelper.accessor("status", {
      header: ({ header }) => (
        <DataTableColumnHeader
          header={header}
          title={t("organization:memberStatus")}
        />
      ),
      cell: ({ getValue }) => {
        const status = getValue()
        return (
          <Badge variant={statusBadgeVariant[status]} className="capitalize">
            {t(`organization:memberStatus_${status}`)}
          </Badge>
        )
      },
      meta: {
        label: t("organization:memberStatus"),
        facetOptions: statusOptions,
      },
    }),
    columnHelper.accessor("department", {
      header: ({ header }) => (
        <DataTableColumnHeader
          header={header}
          title={t("organization:department")}
        />
      ),
      meta: { label: t("organization:department") },
    }),
    columnHelper.accessor("lastActive", {
      header: ({ header }) => (
        <DataTableColumnHeader
          header={header}
          title={t("organization:lastActive")}
        />
      ),
      meta: { label: t("organization:lastActive") },
    }),
  ])
}

export function MembersTable() {
  const { t } = useTranslation(["organization", "common", "auth"])
  const columns = React.useMemo(() => createColumns(t), [t])
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
        {t("common:loading")}
      </Label>
      <DataTable
        columns={columns}
        data={memberData}
        getRowId={(row) => row.id}
        status={isLoading ? "loading" : "ready"}
        searchPlaceholder={t("organization:searchMembers")}
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
              {t("organization:bulkActions")}
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
                {t("organization:activate")}
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
                {t("organization:suspend")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        renderExpandedRow={({ original: member }) => (
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t("auth:email")}</dt>
              <dd className="break-all">{member.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {t("organization:department")}
              </dt>
              <dd>{member.department}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {t("organization:lastActive")}
              </dt>
              <dd>{member.lastActive}</dd>
            </div>
          </dl>
        )}
      />
    </div>
  )
}
