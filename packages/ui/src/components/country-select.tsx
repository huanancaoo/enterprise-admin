"use client"

import * as React from "react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  COUNTRIES,
  Country,
  getCountryFlag,
  getCountryName,
  matchCountry,
} from "@workspace/ui/lib/countries"
import { ChevronsUpDownIcon, XIcon } from "lucide-react"

export interface CountrySelectProps {
  /** 当前选中的国家 ISO 3166-1 alpha-2 代码（受控） */
  value?: string
  /** 默认选中的国家 ISO 代码（非受控） */
  defaultValue?: string
  /** 值发生改变时的回调 */
  onValueChange?: (value: string | undefined) => void
  /** 失焦回调（浮层关闭或 Trigger 失焦时触发） */
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

export function CountrySelect({
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
}: CountrySelectProps) {
  const [open, setOpen] = React.useState(false)
  const isControlled = value !== undefined
  const [internalValue, setInternalValue] = React.useState(defaultValue)
  const currentValue = isControlled ? value : internalValue

  // 计算运行时生效的 Locale
  const activeLocale =
    locale ||
    (typeof document !== "undefined"
      ? document.documentElement.lang
      : undefined) ||
    "en"

  // 基础国家数据集清洗（include / exclude）
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

  // 映射字典与本地化名称缓存
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

  // 当前选中对象及其展示文案
  const selectedCountry = currentValue
    ? countryMap.get(currentValue.toUpperCase())
    : undefined
  const selectedLabel = selectedCountry
    ? localizedMap.get(selectedCountry.code) || selectedCountry.name
    : undefined

  const handleSelect = React.useCallback(
    (code: string | undefined) => {
      if (!isControlled) {
        setInternalValue(code)
      }
      onValueChange?.(code)
    },
    [isControlled, onValueChange]
  )

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      if (!nextOpen) {
        onBlur?.()
      }
    },
    [onBlur]
  )

  // 自定义 cmdk 过滤算法，精确支持非拉丁字符（中文、阿拉伯文等）与别名/区号
  const cmdkFilter = React.useCallback(
    (itemValue: string, search: string) => {
      const query = search.trim().toLowerCase()
      if (!query) return 1
      const country = countryMap.get(itemValue)
      if (!country) return 0
      const locName = localizedMap.get(itemValue) || ""
      if (filterCountry) {
        return filterCountry(country, search, locName) ? 1 : 0
      }
      return matchCountry(country, search, locName) ? 1 : 0
    },
    [countryMap, localizedMap, filterCountry]
  )

  const renderItem = (country: Country) => {
    const isSelected = selectedCountry?.code === country.code
    const isDisabled = isCountryDisabled ? isCountryDisabled(country) : false
    const locName = localizedMap.get(country.code) || country.name

    return (
      <CommandItem
        key={country.code}
        value={country.code}
        disabled={isDisabled}
        data-checked={isSelected}
        onSelect={() => {
          handleSelect(country.code)
          setOpen(false)
        }}
        className="cursor-pointer"
      >
        {showFlag && (
          <span
            className="me-2 shrink-0 text-base leading-none"
            aria-hidden="true"
          >
            {getCountryFlag(country.code)}
          </span>
        )}
        <span className="flex-1 truncate">{locName}</span>
        <span className="ms-2 font-mono text-xs text-muted-foreground uppercase">
          {country.code}
        </span>
      </CommandItem>
    )
  }

  const listId = React.useId()
  const triggerText = selectedCountry ? selectedLabel : placeholder

  return (
    <div className={cn("relative inline-block w-full", className)}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-label={triggerText}
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-haspopup="listbox"
              aria-invalid={invalid}
              disabled={disabled}
              id={id}
              name={name}
              className={cn(
                "w-full justify-between text-start font-normal",
                !selectedCountry && "text-muted-foreground",
                invalid &&
                  "border-destructive focus-visible:ring-destructive/20",
                triggerClassName
              )}
            />
          }
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

          <span className="ms-2 flex shrink-0 items-center gap-1">
            {clearable && selectedCountry && !disabled && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Clear selection"
                onClick={(e) => {
                  e.stopPropagation()
                  handleSelect(undefined)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation()
                    e.preventDefault()
                    handleSelect(undefined)
                  }
                }}
                className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </span>
            )}
            <ChevronsUpDownIcon
              className="size-4 shrink-0 opacity-50"
              aria-hidden="true"
            />
          </span>
        </PopoverTrigger>

        <PopoverContent
          className={cn(
            "w-[--anchor-width] min-w-[260px] p-0",
            contentClassName
          )}
          align={align}
          side={side}
          sideOffset={sideOffset}
          aria-label={searchPlaceholder || placeholder}
        >
          <Command filter={cmdkFilter}>
            <CommandInput
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
            <CommandList id={listId} className="max-h-72">
              <CommandEmpty>{emptyText}</CommandEmpty>
              {preferredList.length > 0 && (
                <CommandGroup heading={preferredHeading}>
                  {preferredList.map(renderItem)}
                </CommandGroup>
              )}
              {otherList.length > 0 && (
                <CommandGroup heading={allHeading}>
                  {otherList.map(renderItem)}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
