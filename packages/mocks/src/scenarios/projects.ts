import { createProjectsHandler } from "../handlers/projects"

export const projectScenarios = {
  success: [createProjectsHandler()],
  empty: [createProjectsHandler("empty")],
  forbidden: [createProjectsHandler("forbidden")],
  serverError: [createProjectsHandler("serverError")],
  slow: [createProjectsHandler("slow")],
  loading: [createProjectsHandler("loading")],
  longText: [createProjectsHandler("longText")],
}
