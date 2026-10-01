import type { SupportedLocale } from "@workspace/i18n"

type OrganizationLocaleSnapshot = {
  userId: string
  organizationId: string | null
  locale: SupportedLocale
}

let lastAppliedSnapshot: OrganizationLocaleSnapshot | undefined
let pendingOrganizationSwitch: OrganizationLocaleSnapshot | undefined
let pendingManualSelectionUserId: string | undefined

export function preserveLocaleOnManualSelection(
  context: Pick<OrganizationLocaleSnapshot, "userId" | "organizationId">
) {
  if (
    lastAppliedSnapshot?.userId === context.userId &&
    lastAppliedSnapshot.organizationId === context.organizationId
  )
    return
  // 初始查询尚未返回时，当前账号已经选定显示语言；首个继承结果只登记基线，不能覆盖用户选择。
  pendingManualSelectionUserId = context.userId
}

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
    pendingOrganizationSwitch?.organizationId === next.organizationId ||
    pendingManualSelectionUserId === next.userId
  pendingManualSelectionUserId = undefined
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
