"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import {
  Combobox,
  ComboboxClear,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@workspace/ui/components/combobox"
import { InputGroupAddon } from "@workspace/ui/components/input-group"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  COUNTRIES,
  Country,
  getCountryFlag,
  getCountryName,
  matchCountry,
} from "@workspace/ui/lib/countries"
import { ChevronsUpDownIcon, SearchIcon } from "lucide-react"

export interface CountrySelectProps {
  /** 当前选中的国家 ISO 3166-1 alpha-2 代码（受控） */
  value?: string
  /** 默认选中的国家 ISO 代码（非受控） */
  defaultValue?: string
  /** 值发生改变时的回调 */
  onValueChange?: (value: string | undefined) => void
  /** 失焦回调（浮层关闭时触发） */
  onBlur?: () => void
  /** 表单字段名 */
  name?: string
  /** DOM id */
  id?: string
  /** 是否整体禁用 */
  disabled?: boolean
  /** 表单校验错误状态 */
  invalid?: boolean

  /** 目标语言（如 "zh-CN", "en-US", "ar"），未传时自动读取当前环境或 fallback "en" */
  locale?: string
  /** 未选择时的占位文本 */
  placeholder?: string
  /** 搜索输入框的占位文本 */
  searchPlaceholder?: string
  /** 搜索无匹配结果时的提示文案 */
  emptyText?: string
  /** 常用推荐分组标题 */
  preferredHeading?: string
  /** 全部国家分组标题 */
  allHeading?: string

  /** 是否显示国旗 Emoji（可选视觉增强） */
  showFlag?: boolean
  /** 是否允许清空已选值 */
  clearable?: boolean

  /** 常用/推荐国家列表（ISO 代码数组），如 ["CN", "US", "SG", "CA"] */
  preferredCountries?: string[]
  /** 白名单过滤（只允许这些 ISO 代码） */
  include?: string[]
  /** 黑名单过滤（排除这些 ISO 代码） */
  exclude?: string[]
  /** 判断特定国家是否在业务上处于禁用态不可选 */
  isCountryDisabled?: (country: Country) => boolean

  /** 自定义或远程注入的国家数据集（默认使用内置 249 个国家与地区） */
  countries?: Country[]
  /** 自定义搜索匹配过滤函数 */
  filterCountry?: (
    country: Country,
    search: string,
    localizedName: string
  ) => boolean

  /** Trigger 外部容器样式类名 */
  className?: string
  /** Trigger 按钮样式类名 */
  triggerClassName?: string
  /** 下拉 Popover 浮层样式类名 */
  contentClassName?: string
  /** 浮层对齐方向 */
  align?: "start" | "center" | "end"
  /** 浮层弹出方向 */
  side?: "top" | "bottom" | "left" | "right"
  /** 浮层与触发器的间距 */
  sideOffset?: number
}

export function CountrySelect(props: CountrySelectProps) {
  const {
    value,
    defaultValue,
    onValueChange,
    onBlur,
    name,
    id,
    disabled = false,
    invalid = false,

    locale,
    placeholder = "Select a country",
    searchPlaceholder = "Search countries...",
    emptyText = "No country found.",
    preferredHeading = "Frequently used",
    allHeading = "All countries",

    showFlag = false,
    clearable = false,

    preferredCountries,
    include,
    exclude,
    isCountryDisabled,

    countries,
    filterCountry,

    className,
    triggerClassName,
    contentClassName,
    align = "start",
    side = "bottom",
    sideOffset = 4,
  } = props
  const activeLocale =
    locale ||
    (typeof document !== "undefined"
      ? document.documentElement.lang
      : undefined) ||
    "en"

  const baseCountries = React.useMemo(() => {
    let list = countries ?? COUNTRIES
    if (include && include.length > 0) {
      const includeSet = new Set(include.map((c) => c.toUpperCase()))
      list = list.filter((c) => includeSet.has(c.code))
    }
    if (exclude && exclude.length > 0) {
      const excludeSet = new Set(exclude.map((c) => c.toUpperCase()))
      list = list.filter((c) => !excludeSet.has(c.code))
    }
    return list
  }, [countries, include, exclude])

  const { countryMap, localizedMap } = React.useMemo(() => {
    const cMap = new Map<string, Country>()
    const lMap = new Map<string, string>()
    for (const c of baseCountries) {
      cMap.set(c.code, c)
      lMap.set(c.code, getCountryName(c.code, activeLocale))
    }
    return { countryMap: cMap, localizedMap: lMap }
  }, [baseCountries, activeLocale])

  // 分组划分（常用分组置顶，全部国家去重保持次序）
  const { preferredList, otherList } = React.useMemo(() => {
    if (!preferredCountries || preferredCountries.length === 0) {
      return { preferredList: [], otherList: baseCountries }
    }
    const preferredSet = new Set(preferredCountries.map((c) => c.toUpperCase()))
    const preferred: Country[] = []
    for (const code of preferredCountries) {
      const upper = code.toUpperCase()
      const item = countryMap.get(upper)
      if (item) preferred.push(item)
    }
    const other = baseCountries.filter((c) => !preferredSet.has(c.code))
    return { preferredList: preferred, otherList: other }
  }, [baseCountries, preferredCountries, countryMap])

  const items = React.useMemo(
    () =>
      ComboboxPrimitive.createItems(
        [
          { id: "preferred", heading: preferredHeading, items: preferredList },
          { id: "all", heading: allHeading, items: otherList },
        ].filter((group) => group.items.length > 0),
        {
          getValue: (country: Country) => country.code,
          getLabel: (country: Country) =>
            localizedMap.get(country.code) || country.name,
        }
      ),
    [preferredHeading, preferredList, allHeading, otherList, localizedMap]
  )

  // 国家搜索还支持区号与别名，不能用仅比较显示名称的默认过滤替代。
  const filter = React.useCallback(
    (country: Country, search: string) => {
      if (!search.trim()) return true
      const localizedName = localizedMap.get(country.code) || ""
      return filterCountry
        ? filterCountry(country, search, localizedName)
        : matchCountry(country, search, localizedName)
    },
    [localizedMap, filterCountry]
  )

  // 表单会显式传入 undefined 清空值，此时仍必须保持受控模式。
  const isControlled = Object.hasOwn(props, "value")

  return (
    <div className={cn("relative inline-block w-full", className)}>
      <Combobox
        items={items}
        value={isControlled ? value?.toUpperCase() || null : undefined}
        defaultValue={defaultValue?.toUpperCase()}
        onValueChange={(code, eventDetails) => {
          const country = code ? countryMap.get(code) : undefined
          // 关闭态的键入匹配也会提交值，禁用约束必须覆盖所有选择入口。
          if (country && isCountryDisabled?.(country)) {
            eventDetails.cancel()
            return
          }
          onValueChange?.(code ?? undefined)
        }}
        onOpenChange={(open) => {
          if (!open) onBlur?.()
        }}
        name={name}
        disabled={disabled}
        filter={filter}
        autoHighlight
      >
        <ComboboxValue>
          {(selectedValue: string | null) => {
            const selectedCountry = selectedValue
              ? countryMap.get(selectedValue)
              : undefined
            const triggerText = selectedCountry
              ? localizedMap.get(selectedCountry.code) || selectedCountry.name
              : placeholder
            const showClear = clearable && selectedCountry && !disabled

            return (
              <>
                <ComboboxTrigger
                  render={<Button type="button" variant="outline" />}
                  showIcon={false}
                  id={id}
                  aria-label={triggerText}
                  aria-invalid={invalid}
                  className={cn(
                    "w-full justify-between text-start font-normal",
                    !selectedCountry && "text-muted-foreground",
                    invalid &&
                      "border-destructive focus-visible:ring-destructive/20",
                    triggerClassName
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-center">
                    {selectedCountry && showFlag && (
                      <span
                        className="me-2 shrink-0 text-base leading-none"
                        aria-hidden="true"
                      >
                        {getCountryFlag(selectedCountry.code)}
                      </span>
                    )}
                    <span className="truncate">{triggerText}</span>
                  </span>
                  <span className={cn("ms-2 shrink-0", showClear && "ps-6")}>
                    <ChevronsUpDownIcon
                      className="size-4 opacity-50"
                      aria-hidden="true"
                    />
                  </span>
                </ComboboxTrigger>
                {showClear && (
                  <ComboboxClear
                    tabIndex={0}
                    aria-label="Clear selection"
                    className="absolute end-9 top-1/2 size-5 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
                  />
                )}
              </>
            )
          }}
        </ComboboxValue>
        <ComboboxContent
          className={cn("min-w-[260px] p-0", contentClassName)}
          align={align}
          side={side}
          sideOffset={sideOffset}
          aria-label={searchPlaceholder || placeholder}
        >
          <ComboboxInput
            showTrigger={false}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          >
            <InputGroupAddon>
              <SearchIcon className="size-4 shrink-0 opacity-50" />
            </InputGroupAddon>
          </ComboboxInput>
          <ComboboxEmpty className="py-6">{emptyText}</ComboboxEmpty>
          <ComboboxList className="max-h-72" aria-label={allHeading}>
            {(group: { id: string; heading: string; items: Country[] }) => (
              <ComboboxGroup key={group.id} items={group.items}>
                <ComboboxLabel>{group.heading}</ComboboxLabel>
                <ComboboxCollection>
                  {(country: Country) => (
                    <ComboboxItem
                      key={country.code}
                      value={country.code}
                      disabled={isCountryDisabled?.(country)}
                      className="cursor-pointer rounded-lg"
                    >
                      {showFlag && (
                        <span
                          className="me-2 shrink-0 text-base leading-none"
                          aria-hidden="true"
                        >
                          {getCountryFlag(country.code)}
                        </span>
                      )}
                      <span className="flex-1 truncate">
                        {localizedMap.get(country.code) || country.name}
                      </span>
                      <span className="ms-2 font-mono text-xs text-muted-foreground uppercase">
                        {country.code}
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}
