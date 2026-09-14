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
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`API request failed with ${status}`)
    this.name = "ApiClientError"
  }
}

export async function apiClient<T>(
  requestPath: string,
  options: ApiClientRequestOptions = {}
): Promise<T> {
  if (!apiClientConfig) {
    throw new Error(
      "API client is not configured. Call configureApiClient first."
    )
  }

  const { params, headers: requestHeaders, ...requestInit } = options

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
  new Headers(requestHeaders).forEach((value, key) => {
    headers.set(key, value)
  })

  const response = await fetch(url, { ...requestInit, headers })

  if (!response.ok) {
    throw new ApiClientError(response.status, await response.text())
  }

  // Orval fetch 默认 T = { data, status, headers }，不能只返回解析后的 body。
  return {
    data: await readResponseData(response),
    status: response.status,
    headers: response.headers,
  } as T
}

async function readResponseData(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined
  }

  const contentType = response.headers.get("content-type")
  if (contentType?.includes("application/json")) {
    return response.json()
  }

  return response.text()
}
