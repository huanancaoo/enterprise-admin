import type { ProjectListQuery } from "@workspace/contracts"

type OrganizationPageDefinition = {
  to: string
  matches: RegExp
  titleKey: string
  detailTitleKey?: string
  management?: boolean
  preserveOnCreate?: boolean
  discardProjectSearch?: boolean
  search?: object
}

// 新领域在此登记业务位置；标题、组织切换和创建组织落点共用同一事实。
const organizationPages = {
  projects: {
    to: "/app/projects/$organizationId",
    matches: /^\/app\/projects\//,
    titleKey: "projects:title",
    detailTitleKey: "projects:detail",
  },
  files: {
    to: "/app/files/$organizationId",
    matches: /^\/app\/files\//,
    titleKey: "files:title",
    detailTitleKey: "files:detail",
    preserveOnCreate: true,
    discardProjectSearch: true,
    search: {},
  },
  announcements: {
    to: "/app/announcements/$organizationId",
    matches: /^\/app\/announcements\//,
    titleKey: "announcements:title",
    search: { page: 1, pageSize: 20 },
  },
  notifications: {
    to: "/app/notifications/$organizationId",
    matches: /^\/app\/notifications\//,
    titleKey: "notifications:title",
    search: { page: 1, pageSize: 20 },
  },
  tasks: {
    to: "/app/tasks/$organizationId",
    matches: /^\/app\/tasks\//,
    titleKey: "tasks:title",
    search: { page: 1, pageSize: 20 },
  },
  integrations: {
    to: "/app/integrations/$organizationId",
    matches: /^\/app\/integrations\//,
    titleKey: "webhooks:integrations",
    management: true,
  },
  members: {
    to: "/app/members/$organizationId",
    matches: /^\/app\/members\//,
    titleKey: "organization:members",
    management: true,
    preserveOnCreate: true,
    discardProjectSearch: true,
  },
  roles: {
    to: "/app/organizations/$organizationId/roles",
    matches: /^\/app\/organizations\/[^/]+\/roles\/?$/,
    titleKey: "organization:roles",
    management: true,
    preserveOnCreate: true,
    discardProjectSearch: true,
  },
  organizationSettings: {
    to: "/app/organizations/$organizationId/settings",
    matches: /^\/app\/organizations\/.*\/settings$/,
    titleKey: "settings:organizationSettings",
    management: true,
    preserveOnCreate: true,
  },
  audit: {
    to: "/app/organizations/$organizationId/audit",
    matches: /^\/app\/organizations\/.*\/audit$/,
    titleKey: "organization:audit",
    preserveOnCreate: true,
    discardProjectSearch: true,
    search: { page: 1, pageSize: 20 },
  },
} as const satisfies Record<string, OrganizationPageDefinition>

type OrganizationPage = keyof typeof organizationPages

type OrganizationLocationInput = {
  pathname: string
  params: { projectId?: string; entryId?: string }
  search: Omit<Partial<ProjectListQuery>, "sortBy"> & { sortBy?: string }
}

export function getOrganizationLocation({
  pathname,
  params,
  search,
}: OrganizationLocationInput) {
  const organizationPage = (
    Object.keys(organizationPages) as OrganizationPage[]
  ).find((key) => organizationPages[key].matches.test(pathname))
  const personal = pathname.startsWith("/app/settings/")
  const page = organizationPage ?? (personal ? "personalSettings" : "projects")
  const definition: OrganizationPageDefinition =
    organizationPages[organizationPage ?? "projects"]
  const projectDetail = Boolean(params.projectId)
  const fileDetail = Boolean(params.entryId)
  const projectSearch =
    !definition.discardProjectSearch &&
    (search.sortBy === "createdAt" || search.sortBy === "updatedAt")
      ? {
          page: search.page,
          pageSize: search.pageSize,
          status: search.status,
          name: search.name,
          sortBy: search.sortBy,
          sortOrder: search.sortOrder,
        }
      : {}

  function target(
    key: OrganizationPage,
    organizationId: string,
    purpose: "link" | "switch" | "created"
  ) {
    const definition = organizationPages[key]
    if (purpose === "created")
      return { to: definition.to, params: { organizationId } }
    if (key === "projects")
      return {
        to: definition.to,
        params: { organizationId },
        search: projectDetail
          ? {}
          : purpose === "switch"
            ? { ...projectSearch, page: 1 }
            : projectSearch,
      }
    return {
      to: definition.to,
      params: { organizationId },
      ...("search" in definition ? { search: definition.search } : {}),
    }
  }

  return {
    page,
    personal,
    management: Boolean(definition.management),
    projectDetail,
    layout:
      page === "files" && !fileDetail
        ? ("workspace" as const)
        : ("page" as const),
    titleKey: personal
      ? pathname === "/app/settings/login-events"
        ? ("identity:personalLoginEvents" as const)
        : ("settings:personalSettings" as const)
      : page === "files" && fileDetail
        ? organizationPages.files.detailTitleKey
        : projectDetail
          ? organizationPages.projects.detailTitleKey
          : organizationPages[organizationPage ?? "projects"].titleKey,
    link: (key: OrganizationPage, organizationId: string) =>
      target(key, organizationId, "link"),
    switchTarget: (organizationId: string) =>
      target(organizationPage ?? "projects", organizationId, "switch"),
    // 创建组织只保留原有可直接管理的落点；通知等组织内容不随创建动作继承。
    createdTarget: (organizationId: string) =>
      target(
        definition.preserveOnCreate ? organizationPage! : "projects",
        organizationId,
        "created"
      ),
  }
}
