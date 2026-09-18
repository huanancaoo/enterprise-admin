export function assertAllowedEmailUrl(
  urlString: string,
  allowedOrigins: string[],
): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('URL_NOT_ALLOWED');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL_NOT_ALLOWED');
  }
  if (url.username || url.password) {
    throw new Error('URL_NOT_ALLOWED');
  }
  const allowed = allowedOrigins.some((origin) => {
    const allowedOrigin = new URL(origin);
    return (
      allowedOrigin.protocol === url.protocol && allowedOrigin.host === url.host
    );
  });
  if (!allowed) throw new Error('URL_NOT_ALLOWED');
  return url;
}

export function emailOriginAllowlist(
  baseURL: string,
  linkOrigin: string,
  trustedOrigins: string[],
): string[] {
  return [...new Set([baseURL, linkOrigin, ...trustedOrigins])].map(
    (origin) => {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`email origin is not http(s): ${origin}`);
      }
      return url.origin;
    },
  );
}
