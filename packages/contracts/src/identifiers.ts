import { z } from "zod"

export const OrganizationIdSchema = z.uuidv4()
export const ProjectIdSchema = z.uuid()
export const UserIdSchema = z.uuid()
