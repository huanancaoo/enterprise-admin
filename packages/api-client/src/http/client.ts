import { ApiErrorSchema, type ApiError } from "@workspace/contracts"
import { boundRequestLocale, requestLanguageHeader } from "./request-locale"

export type ApiClientConfig = {
  baseUrl: string
  getHeaders?: () => HeadersInit | Promise<HeadersInit>
}

let apiClientConfig: ApiClientConfig | undefined

export function configureApiClient(config: ApiClientConfig): void {
  apiClientConfig = config
}

export type ApiClientRequestOptions = RequestInit & {
  params?: Record<string, unknown>
  responseType?: "blob"
}

export class ApiClientError extends Error {
  readonly status: number
  readonly body: ApiError

  constructor(status: number, body: ApiError) {
    super(body.message)
    this.name = "ApiClientError"
    this.status = status
    this.body = body
  }
}

export type ErrorType<T> = ApiClientError & { readonly body: T & ApiError }

export async function apiClient<T>(
  requestPath: string,
  options: ApiClientRequestOptions = {}
): Promise<T> {
  if (!apiClientConfig) {
    throw new Error(
      "API client is not configured. Call configureApiClient first."
    )
  }

  const {
    params,
    responseType,
    headers: requestHeaders,
    ...requestInit
  } = options

  // OpenAPI paths already include /api/v1, so baseUrl is origin only.
  const url = new URL(requestPath, apiClientConfig.baseUrl)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) {
        continue
      }
      url.searchParams.set(key, String(value))
    }
  }

  const headers = new Headers(await apiClientConfig.getHeaders?.())
  const boundLocale = boundRequestLocale()
  if (boundLocale && !headers.has(requestLanguageHeader)) {
    headers.set(requestLanguageHeader, boundLocale)
  }
  new Headers(requestHeaders).forEach((value, key) => {
    headers.set(key, value)
  })

  const response = await fetch(url, {
    credentials: "include",
    ...requestInit,
    headers,
  })

  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      ApiErrorSchema.parse(await response.json())
    )
  }

  // Orval fetch 默认 T = { data, status, headers }，不能只返回解析后的 body。
  return {
    data: await readResponseData(response, responseType),
    status: response.status,
    headers: response.headers,
  } as T
}

async function readResponseData(
  response: Response,
  responseType: ApiClientRequestOptions["responseType"]
): Promise<unknown> {
  if (response.status === 204) {
    return undefined
  }

  // 文件内容可能也是 JSON 或纯文本；明确读取原始字节时不能按 MIME 解码。
  if (responseType === "blob") {
    return response.blob()
  }

  const contentType = response.headers.get("content-type")
  if (contentType?.includes("application/json")) {
    return response.json()
  }

  return response.text()
}
