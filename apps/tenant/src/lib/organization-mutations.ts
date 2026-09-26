import { authErrorMessage } from "@workspace/admin/auth"

export function organizationWriteOptions(authorizationVersion: number) {
  return {
    fetchOptions: {
      headers: { "X-Expected-Authz-Version": String(authorizationVersion) },
    },
  }
}

export class OrganizationMutationError extends Error {
  constructor(
    error: { code?: string; message?: string; status: number },
    defaultMessage: string
  ) {
    super(authErrorMessage(error, defaultMessage))
    this.code = error.code
  }

  readonly code: string | undefined
}
