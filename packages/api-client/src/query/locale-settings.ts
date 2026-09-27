import { queryOptions } from "@tanstack/react-query"
import {
  getMyPreferences,
  getOrganizationSettings,
} from "../generated/endpoints/locale-settings/locale-settings"

export const localeSettingsKeys = {
  personal: (userId: string) =>
    ["users", userId, "preferences", "locale"] as const,
  organization: (organizationId: string) =>
    ["organizations", organizationId, "settings", "locale"] as const,
}

export function getMyPreferencesOptions(userId: string) {
  return queryOptions({
    queryKey: localeSettingsKeys.personal(userId),
    queryFn: ({ signal }) => getMyPreferences({ signal }),
  })
}

export function getOrganizationSettingsOptions(organizationId: string) {
  return queryOptions({
    queryKey: localeSettingsKeys.organization(organizationId),
    queryFn: ({ signal }) =>
      getOrganizationSettings(organizationId, { signal }),
    retry: false,
  })
}
