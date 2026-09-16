import type { ProjectResponse, SupportedLocale } from "@workspace/contracts"

export const organizations = [
  { id: "11111111-1111-4111-8111-111111111111", name: "North workspace" },
  { id: "22222222-2222-4222-8222-222222222222", name: "South workspace" },
] as const

const projectNames = {
  "zh-CN": "办公空间",
  "en-US": "Office space",
  ar: "مساحة المكتب",
}
export function projectFixtures(
  organizationId: string,
  locale: SupportedLocale
): ProjectResponse[] {
  const organizationIndex = organizations.findIndex(
    (organization) => organization.id === organizationId
  )
  if (organizationIndex === -1) return []
  return Array.from({ length: 26 }, (_, index) => ({
    id: `00000000-0000-4000-800${organizationIndex}-${String(index + 1).padStart(12, "0")}`,
    organizationId,
    name: `${projectNames[locale]} ${organizationIndex + 1}-${index + 1}`,
    description: null,
    status: (["draft", "active", "archived"] as const)[index % 3]!,
    contentLocale: "zh-CN",
    resolvedLocale: locale,
    createdAt: new Date(Date.UTC(2026, 8, index + 1)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 8, index + 1)).toISOString(),
  }))
}
