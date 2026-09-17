import { AsyncLocalStorage } from "node:async_hooks"
import type {
  BetterAuthOptions,
  BetterAuthPlugin,
  DBAdapter,
} from "better-auth"
import { APIError } from "better-auth/api"
import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { drizzle } from "drizzle-orm/node-postgres"
import type { Pool, PoolClient, QueryResultRow } from "pg"
import * as schema from "./schema/auth.ts"

type AdapterFactory = (options: BetterAuthOptions) => DBAdapter

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const value = error as { code?: string; cause?: unknown }
  return value.code ?? databaseErrorCode(value.cause)
}

export function createTransactionalAuthAdapter(pool: Pool) {
  const database = drizzle(pool)
  const transactionContext = new AsyncLocalStorage<{
    adapter: DBAdapter
    client: PoolClient
  }>()
  const baseFactory = drizzleAdapter(database, {
    provider: "pg",
    schema,
    transaction: true,
  })
  let options: BetterAuthOptions | undefined
  let baseAdapter: DBAdapter | undefined

  const adapterFactory: AdapterFactory = (authOptions) => {
    options = authOptions
    baseAdapter = baseFactory(authOptions)
    return new Proxy(baseAdapter, {
      get(target, property) {
        const adapter = transactionContext.getStore()?.adapter ?? target
        const value = Reflect.get(adapter, property, adapter)
        return typeof value === "function" ? value.bind(adapter) : value
      },
    })
  }

  async function run<T>(work: () => Promise<T>): Promise<T> {
    if (transactionContext.getStore()) return work()
    const authOptions = options
    if (!authOptions || !baseAdapter)
      throw new Error("Better Auth adapter is not initialized")

    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const transactionAdapter = drizzleAdapter(drizzle(client), {
        provider: "pg",
        schema,
        transaction: false,
      })(authOptions)
      const result = await transactionContext.run(
        { adapter: transactionAdapter, client },
        work
      )
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK")
      if (databaseErrorCode(error) === "40001")
        throw new APIError("CONFLICT", {
          code: "AUTHORIZATION_VERSION_CONFLICT",
          message: "AUTHORIZATION_VERSION_CONFLICT",
        })
      throw error
    } finally {
      client.release()
    }
  }

  function query<Row extends QueryResultRow>(text: string, values?: unknown[]) {
    return (transactionContext.getStore()?.client ?? pool).query<Row>(
      text,
      values
    )
  }

  return { adapterFactory, run, query }
}

type EndpointFunction = ((...args: unknown[]) => unknown) & {
  method?: string
}

const transactionalOrganizationEndpoints = new Set([
  "createOrganization",
  "updateOrganization",
  "deleteOrganization",
  "setActiveOrganization",
  "createInvitation",
  "cancelInvitation",
  "acceptInvitation",
  "rejectInvitation",
  "addMember",
  "removeMember",
  "updateMemberRole",
  "leaveOrganization",
  "createOrgRole",
  "updateOrgRole",
  "deleteOrgRole",
])

export function wrapTransactionalOrganizationEndpoints<
  Plugin extends BetterAuthPlugin,
>(
  plugin: Plugin,
  run: <T>(work: () => Promise<T>) => Promise<T>,
  prepare: (context: unknown) => Promise<void>
): Plugin {
  const endpoints = plugin.endpoints as Record<string, EndpointFunction>
  for (const [key, endpoint] of Object.entries(endpoints)) {
    if (!transactionalOrganizationEndpoints.has(key)) continue
    const transactionalEndpoint = (async (...args: unknown[]) =>
      run(async () => {
        await prepare(args[0])
        return endpoint(...args)
      })) as EndpointFunction
    Object.assign(transactionalEndpoint, endpoint)
    endpoints[key] = transactionalEndpoint
  }
  return plugin
}
