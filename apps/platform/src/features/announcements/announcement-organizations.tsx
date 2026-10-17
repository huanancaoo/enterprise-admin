import { useTranslation } from "react-i18next"
import { Button } from "@workspace/ui/components/button"
import { OrganizationCombobox } from "../../components/organization-combobox"

export function AnnouncementOrganizationsField({
  value,
  onChange,
  invalid,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  invalid: boolean
}) {
  const { t } = useTranslation(["announcements", "common"])
  return (
    <div className="space-y-2">
      {value.map((id, index) => (
        <div key={id} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <OrganizationCombobox
              value={id}
              invalid={invalid}
              placeholder={t("chooseOrganizations")}
              onValueChange={(next) => {
                if (!next) onChange(value.filter((entry) => entry !== id))
                else if (!value.includes(next))
                  onChange(
                    value.map((entry, current) =>
                      current === index ? next : entry
                    )
                  )
              }}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => onChange(value.filter((entry) => entry !== id))}
            aria-label={t("removeOrganization")}
          >
            {t("removeOrganization")}
          </Button>
        </div>
      ))}
      <OrganizationCombobox
        value={null}
        invalid={invalid}
        placeholder={t("chooseOrganizations")}
        onValueChange={(next) => {
          if (next && !value.includes(next)) onChange([...value, next])
        }}
      />
    </div>
  )
}
