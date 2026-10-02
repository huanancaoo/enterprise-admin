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
    afterCommit: (() => Promise<void>)[]
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

  // 调用方拥有事务与连接；纯原生权限复核沿用同一连接，不能再借等待这些行锁的身份 pool。
  async function withDatabaseClient<T>(
    client: PoolClient,
    work: () => Promise<T>
  ): Promise<T> {
    const authOptions = options
    if (!authOptions || !baseAdapter)
      throw new Error("Better Auth adapter is not initialized")
    const adapter = drizzleAdapter(drizzle(client), {
      provider: "pg",
      schema,
      transaction: false,
    })(authOptions)
    return transactionContext.run({ adapter, client, afterCommit: [] }, work)
  }

  async function run<T>(work: () => Promise<T>): Promise<T> {
    if (transactionContext.getStore()) return work()
    const authOptions = options
    if (!authOptions || !baseAdapter)
      throw new Error("Better Auth adapter is not initialized")

    const afterCommit: (() => Promise<void>)[] = []
    let result: T
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const transactionAdapter = drizzleAdapter(drizzle(client), {
        provider: "pg",
        schema,
        transaction: false,
      })(authOptions)
      result = await transactionContext.run(
        { adapter: transactionAdapter, client, afterCommit },
        work
      )
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      const databaseCode = databaseErrorCode(error)
      const authCode = error instanceof APIError ? error.body?.code : undefined
      if (
        databaseCode === "ORG07" ||
        authCode === "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER" ||
        authCode === "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER"
      ) {
        throw new APIError("CONFLICT", {
          code: "LAST_OWNER_REQUIRED",
          message: "LAST_OWNER_REQUIRED",
        })
      }
      if (databaseCode === "ORS01") {
        throw new APIError(503, {
          code: "AUTHORIZATION_UNAVAILABLE",
          message: "AUTHORIZATION_UNAVAILABLE",
        })
      }
      if (databaseCode === "ORS02") {
        throw new APIError("FORBIDDEN", {
          code: "ORGANIZATION_SUSPENDED",
          message: "ORGANIZATION_SUSPENDED",
        })
      }
      if (databaseCode === "40001")
        throw new APIError("CONFLICT", {
          code: "AUTHORIZATION_VERSION_CONFLICT",
          message: "AUTHORIZATION_VERSION_CONFLICT",
        })
      throw error
    } finally {
      client.release()
    }
    // SMTP 与数据库没有共同事务；提交后仍由本请求等待发送并记录真实结果。
    for (const send of afterCommit) await send()
    return result
  }

  function query<Row extends QueryResultRow>(text: string, values?: unknown[]) {
    return (transactionContext.getStore()?.client ?? pool).query<Row>(
      text,
      values
    )
  }

  function deferUntilCommit(work: () => Promise<void>) {
    const context = transactionContext.getStore()
    if (!context)
      throw new Error("Invitation delivery requires an auth transaction")
    context.afterCommit.push(work)
  }

  return { adapterFactory, run, query, deferUntilCommit, withDatabaseClient }
}

type EndpointFunction = ((...args: unknown[]) => unknown) & {
  method?: string
  options?: {
    body?: { safeParseAsync: (body: unknown) => Promise<{ success: boolean }> }
  }
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
  prepare: (context: unknown) => Promise<{ result: unknown } | void>
): Plugin {
  const endpoints = plugin.endpoints as Record<string, EndpointFunction>
  for (const [key, endpoint] of Object.entries(endpoints)) {
    if (!transactionalOrganizationEndpoints.has(key)) continue
    const transactionalEndpoint = (async (...args: unknown[]) => {
      const context = args[0] as { body?: unknown }
      if (
        endpoint.options?.body &&
        !(await endpoint.options.body.safeParseAsync(context.body)).success
      ) {
        return endpoint(...args)
      }
      return run(async () => {
        const prepared = await prepare(args[0])
        if (prepared)
          return {
            response: prepared.result,
            status: 200,
            headers: new Headers(),
          }
        return endpoint(...args)
      })
    }) as EndpointFunction
    Object.assign(transactionalEndpoint, endpoint)
    endpoints[key] = transactionalEndpoint
  }
  return plugin
}
