import { ApiClientError } from "@workspace/api-client"
import type { DataTableStatus } from "../components/data-table"

export function getDataTableQueryStatus(query: {
  isError: boolean
  error: unknown
  isPending: boolean
  isFetching: boolean
}): DataTableStatus {
  if (query.isError)
    return query.error instanceof ApiClientError && query.error.status === 403
      ? "forbidden"
      : "error"
  if (query.isPending) return "loading"
  return query.isFetching ? "refreshing" : "ready"
}
