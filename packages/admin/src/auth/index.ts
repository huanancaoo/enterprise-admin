export { createWorkspaceAuthClient } from "./client"
export type { WorkspaceAuthClient } from "./client"
export {
  AuthGate,
  CredentialsPage,
  AuthenticatedSessionProvider,
} from "./auth-session"
export { createSessionQueryClient } from "./workspace-router"
export type { WorkspaceRouterContext } from "./workspace-router"
export { useAuthenticatedSession } from "./authenticated-session"
export type { AuthenticatedSession } from "./authenticated-session"
export { useAuthAction } from "./use-auth-action"
export { authErrorMessage } from "./auth-error"
export type { AuthClientError } from "./auth-error"
export { bindWorkspaceRequestLocale } from "./request-locale"
export { useWorkspaceAuthClient } from "./auth-client-context"
export {
  ForgotPasswordPage,
  ResetPasswordPage,
  EmailVerifiedPage,
  AcceptInvitationPage,
} from "./auth-pages"
