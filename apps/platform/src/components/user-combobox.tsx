import {
  PlatformEntityCombobox,
  type PlatformEntityComboboxProps,
} from "./platform-entity-combobox"

export function UserCombobox(props: PlatformEntityComboboxProps) {
  return <PlatformEntityCombobox kind="user" props={props} />
}
