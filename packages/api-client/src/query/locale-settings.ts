import { queryOptions } from "@tanstack/react-query"
import {
  getMyPreferences,
  getOrganizationSettings,
} from "../generated/endpoints/locale-settings/locale-settings"

export const localeSettingsKeys = {
  personal: () => ["me", "preferences", "locale"] as const,
  organization: (organizationId: string) =>
    ["organizations", organizationId, "settings", "locale"] as const,
}

export function getMyPreferencesOptions() {
  return queryOptions({
    queryKey: localeSettingsKeys.personal(),
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
