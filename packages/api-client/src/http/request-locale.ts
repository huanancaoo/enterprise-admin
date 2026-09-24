let readLocale: (() => string) | undefined

export const requestLanguageHeader = "Accept-Language"

export function bindRequestLocale(read: () => string): void {
  readLocale = read
}

export function boundRequestLocale(): string | undefined {
  return readLocale?.()
}

export function requestLocale(): string {
  const locale = readLocale?.()
  if (!locale) {
    throw new Error(
      "Request locale is not bound. Call bindWorkspaceRequestLocale before auth requests."
    )
  }
  return locale
}

export function requestLanguageHeaders(locale: string): {
  "Accept-Language": string
} {
  return { [requestLanguageHeader]: locale }
}
