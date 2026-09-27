import type { SupportedLocale } from "@workspace/i18n"

type OrganizationLocaleSnapshot = {
  userId: string
  organizationId: string
  locale: SupportedLocale
}

let lastAppliedSnapshot: OrganizationLocaleSnapshot | undefined
let pendingOrganizationSwitch: OrganizationLocaleSnapshot | undefined

export function preserveLocaleOnOrganizationSwitch(
  snapshot: OrganizationLocaleSnapshot
) {
  pendingOrganizationSwitch = snapshot
}

export function cancelOrganizationSwitchLocale(
  snapshot: OrganizationLocaleSnapshot
) {
  if (
    pendingOrganizationSwitch?.userId === snapshot.userId &&
    pendingOrganizationSwitch.organizationId === snapshot.organizationId
  )
    pendingOrganizationSwitch = undefined
}

export function shouldApplyOrganizationLocale(
  next: OrganizationLocaleSnapshot
) {
  if (pendingOrganizationSwitch?.userId !== next.userId)
    pendingOrganizationSwitch = undefined
  const preserveCurrentLocale =
    pendingOrganizationSwitch?.organizationId === next.organizationId
  if (preserveCurrentLocale) pendingOrganizationSwitch = undefined

  if (
    lastAppliedSnapshot?.userId === next.userId &&
    lastAppliedSnapshot.organizationId === next.organizationId &&
    lastAppliedSnapshot.locale === next.locale
  ) {
    return false
  }
  lastAppliedSnapshot = next
  return !preserveCurrentLocale
}
