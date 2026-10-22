import { ApiClientError } from "@workspace/api-client"
export function fileRequestErrorMessage(error: unknown, generic: string) {
  return error instanceof ApiClientError ? error.body.message : generic
}
export function fileRequestIsDenied(error: unknown) {
  return error instanceof ApiClientError && error.status === 403
}
