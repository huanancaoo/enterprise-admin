export function utcDateTimeFilterValues(search: {
  from?: string
  to?: string
}) {
  return {
    from: search.from ? new Date(search.from).toISOString().slice(0, 16) : "",
    to: search.to ? new Date(search.to).toISOString().slice(0, 16) : "",
  }
}

export function utcDateTimeFilterQuery(value: { from: string; to: string }) {
  // 控件显示 UTC 的年月日时分；提交时显式补上 UTC，不能按浏览器本地时区解释。
  return {
    from: value.from ? `${value.from}:00Z` : undefined,
    to: value.to ? `${value.to}:00Z` : undefined,
  }
}
