export function isOrganizationRolesPath(pathname: string) {
  return /^\/app\/organizations\/[^/]+\/roles\/?$/.test(pathname)
}
