import { useId, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { localeMeta, supportedLocales } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { DirectionProvider } from "@workspace/ui/components/direction"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@workspace/ui/components/select"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Button } from "@workspace/ui/components/button"
import { GlobeIcon, ChevronDownIcon } from "lucide-react"
import { cn } from "cn"

export function AdminDirectionProvider({ children }: { children: ReactNode }) {
  const locale = useUiLocale()
  return (
    <DirectionProvider direction={localeMeta[locale].direction}>
      {children}
    </DirectionProvider>
  )
}

export type LocaleSwitcherProps = {
  variant?: "dropdown" | "icon" | "select" | "submenu"
  align?: "start" | "end" | "center"
  className?: string
}

export function LocaleSwitcher({
  variant = "dropdown",
  align = "end",
  className,
}: LocaleSwitcherProps = {}) {
  const { t, i18n } = useTranslation("common")
  const locale = useUiLocale()
  const id = useId()

  if (variant === "submenu") {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={className}>
          <GlobeIcon aria-hidden="true" />
          <span>{t("language")}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={locale}
            onValueChange={(value) => {
              if (value) void i18n.changeLanguage(value)
            }}
          >
            {supportedLocales.map((value) => (
              <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                {localeMeta[value].label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }

  if (variant === "select") {
    return (
      <Field
        orientation="horizontal"
        className={cn("w-fit max-w-full", className)}
      >
        <FieldLabel htmlFor={id}>{t("language")}</FieldLabel>
        <Select
          value={locale}
          items={Object.fromEntries(
            supportedLocales.map((value) => [value, localeMeta[value].label])
          )}
          onValueChange={(value) => {
            if (value !== null) void i18n.changeLanguage(value)
          }}
        >
          <SelectTrigger id={id} className="min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {supportedLocales.map((value) => (
              <SelectItem key={value} value={value}>
                {localeMeta[value].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    )
  }

  const isIconOnly = variant === "icon"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size={isIconOnly ? "icon-sm" : "sm"}
            className={cn("cursor-pointer", className)}
            aria-label={t("language")}
          />
        }
      >
        <GlobeIcon
          className="size-4 shrink-0"
          data-icon={isIconOnly ? undefined : "inline-start"}
          aria-hidden="true"
        />
        {!isIconOnly && <span>{localeMeta[locale].label}</span>}
        {!isIconOnly && (
          <ChevronDownIcon
            className="size-3.5 shrink-0 opacity-60"
            data-icon="inline-end"
            aria-hidden="true"
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => {
            if (value) void i18n.changeLanguage(value)
          }}
        >
          {supportedLocales.map((value) => (
            <DropdownMenuRadioItem key={value} value={value} closeOnClick>
              {localeMeta[value].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TenantSwitcher({
  organizations,
  organizationId,
  onSelect,
  disabled = false,
}: {
  organizations: readonly { id: string; name: string }[]
  organizationId: string | null
  onSelect: (organizationId: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation("organization")
  const id = useId()
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={id}>{t("select")}</FieldLabel>
      <Select
        value={organizationId}
        disabled={disabled || organizations.length === 0}
        items={Object.fromEntries(
          organizations.map((organization) => [
            organization.id,
            organization.name,
          ])
        )}
        onValueChange={(value) => {
          if (value !== null) onSelect(value)
        }}
      >
        <SelectTrigger id={id} className="w-full min-w-0">
          <SelectValue placeholder={t("select")} />
        </SelectTrigger>
        <SelectContent className="max-w-[calc(100vw-2rem)]">
          {organizations.map((organization) => (
            <SelectItem
              key={organization.id}
              value={organization.id}
              className="[&>span]:min-w-0 [&>span]:whitespace-normal"
            >
              {organization.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

// 只控制展示；服务端仍须对每个操作验证组织权限和资源范围。
export function PermissionGate({
  allowed,
  children,
  denied = null,
}: {
  allowed: boolean
  children: ReactNode
  denied?: ReactNode
}) {
  return allowed ? children : denied
}
