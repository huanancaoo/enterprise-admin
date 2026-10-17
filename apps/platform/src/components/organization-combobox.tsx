import {
  PlatformEntityCombobox,
  type PlatformEntityComboboxProps,
} from "./platform-entity-combobox"

export function OrganizationCombobox(props: PlatformEntityComboboxProps) {
  return <PlatformEntityCombobox kind="organization" props={props} />
}
