import { afterEach, describe, expect, it } from "vitest"
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as prettier from "prettier"
import { parseConfig } from "../../scripts/domain-scaffold/config.mjs"
import {
  planDomain,
  writePlan,
} from "../../scripts/domain-scaffold/generate.mjs"
import {
  assertSchemaCurrent,
  generateMigrations,
} from "../../scripts/domain-scaffold/cli.mjs"
import { integrationPaths } from "../../scripts/domain-scaffold/registry.mjs"
import { accessSql } from "../../scripts/domain-scaffold/templates.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const config = JSON.parse(
  await readFile(join(root, "scripts/domain-scaffold/example.json"), "utf8")
)
const temporary: string[] = []
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "domain-scaffold-test-"))
  temporary.push(directory)
  const files = [
    "package.json",
    ...integrationPaths,
    "packages/database/package.json",
    ...["zh-CN", "en-US", "ar"].map(
      (locale) => `packages/i18n/src/locales/${locale}/organization.json`
    ),
  ]
  for (const file of files) {
    await mkdir(dirname(join(directory, file)), { recursive: true })
    await cp(join(root, file), join(directory, file))
  }
  await cp(
    join(root, "packages/database/src/schema"),
    join(directory, "packages/database/src/schema"),
    { recursive: true }
  )
  await mkdir(join(directory, "packages/database/migrations/meta"), {
    recursive: true,
  })
  await writeFile(
    join(directory, "packages/database/migrations/meta/_journal.json"),
    JSON.stringify({ entries: [] })
  )
  return directory
}
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe("business domain scaffold", { timeout: 30_000 }, () => {
  it("requires explicit grants, constraints and all three translations without inferring business rules", () => {
    const parsed = parseConfig(config)
    expect(parsed.grants.member).toEqual(["read"])
    expect(() => parseConfig({ ...config, grants: undefined })).toThrow()
    expect(() =>
      parseConfig({ ...config, name: { minLength: 3, maxLength: 2 } })
    ).toThrow()
    expect(() =>
      parseConfig({ ...config, extraSql: "DROP TABLE user" })
    ).toThrow()
    expect(() =>
      parseConfig({ ...config, labels: { "zh-CN": config.labels["zh-CN"] } })
    ).toThrow()
    expect(() =>
      parseConfig({
        ...config,
        grants: { ...config.grants, member: ["read", "read"] },
      })
    ).toThrow()
    for (const name of [
      "../escape",
      "test-name",
      "x;drop",
      "class",
      "organization",
    ])
      expect(() => parseConfig({ ...config, entity: name })).toThrow()
  })
  it("registers the complete vertical module and preserves declarations from other modules", async () => {
    const directory = await fixture()
    const before = await readFile(
      join(directory, "packages/permissions/src/index.ts"),
      "utf8"
    )
    const plan = await planDomain(directory, config)
    await writePlan(plan)
    const read = (path: string) => readFile(join(directory, path), "utf8")
    const service = await read("apps/api/src/labels/labels.ts")
    expect(service).toMatch(
      /this\.writes\.transaction\(\s*context,\s*headers,\s*\[\{\s*label:\s*\[['"]create['"]\]/
    )
    expect(service).toMatch(/await auditRepository\.record\(\s*tx/)
    expect(service).not.toContain("ProjectFiles")
    const repository = await read(
      "packages/database/src/repositories/labels.ts"
    )
    expect(repository).toContain("organizationId: tx.context.organizationId")
    expect(repository).not.toMatch(/new Pool|createTenantRunner/)
    const permission = await read("packages/permissions/src/index.ts")
    expect(permission).toContain('label: ["read"]')
    expect(permission).toContain("project: projectActions")
    expect(before).toContain("project: projectActions")
    expect(await read("apps/tenant/src/router.tsx")).toContain(
      "labelsLayoutRoute.addChildren([labelsRoute])"
    )
    const layout = await read("apps/tenant/src/components/admin-layout.tsx")
    expect(layout).toContain('location.link("labels", currentOrganizationId)')
    expect(
      layout.indexOf('location.link("labels", currentOrganizationId)')
    ).toBeLessThan(layout.indexOf('label: t("organization:management")'))
    const { getOrganizationLocation } = await import(
      /* @vite-ignore */ pathToFileURL(
        join(directory, "apps/tenant/src/lib/organization-location.ts")
      ).href
    )
    const location = getOrganizationLocation({
      pathname: "/app/labels/original",
      params: {},
      search: { page: 3, name: "prior organization", sortBy: "createdAt" },
    })
    expect(location.titleKey).toBe("labels:title")
    expect(location.sectionTitleKey).toBe("organization:businessWork")
    expect(location.switchTarget("next")).toEqual({
      to: "/app/labels/$organizationId",
      params: { organizationId: "next" },
      search: { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" },
    })
    expect(location.createdTarget("created")).toEqual({
      to: "/app/labels/$organizationId",
      params: { organizationId: "created" },
    })
    expect(location.link("projects", "next").search).toEqual({})
    expect(await read("packages/i18n/scripts/check-catalogs.mjs")).toContain(
      '"labels"'
    )
    expect(await read("packages/i18n/src/resources.ts")).toContain(
      "labels: labels2"
    )
    expect(
      JSON.parse(await read("packages/i18n/src/locales/ar/organization.json"))
    ).toHaveProperty("rolePermission_label_delete")
    const table = await read("apps/tenant/src/features/labels/labels-list.tsx")
    expect(table).toContain("<DataTable")
    expect(table).toContain("<form.Field")
    expect(table).toContain("<AlertDialog")
    expect(table).toContain("client.removeQueries")
    expect(await read("apps/api/src/labels/labels.spec.ts")).toContain(
      "audit unavailable"
    )
    expect(await read("tests/api/labels.test.mjs")).toContain(
      "relforcerowsecurity"
    )
  })
  it("plans deterministically, performs no writes while planning and rejects duplicate generation", async () => {
    const directory = await fixture()
    const first = await planDomain(directory, config)
    const second = await planDomain(directory, config)
    expect([...first.files]).toEqual([...second.files])
    for (const [path, content] of first.files) {
      const options = await prettier.resolveConfig(join(directory, path))
      expect(
        await prettier.format(content, {
          ...options,
          filepath: join(directory, path),
        }),
        path
      ).toBe(content)
    }
    await expect(
      lstat(join(directory, "packages/database/src/schema/labels.ts"))
    ).rejects.toHaveProperty("code", "ENOENT")
    await writePlan(first)
    await expect(planDomain(directory, config)).rejects.toThrow(
      "already exists"
    )
  })
  it("rejects an existing SQL table before modifying registered files", async () => {
    const directory = await fixture()
    const before = await readFile(
      join(directory, "packages/permissions/src/index.ts"),
      "utf8"
    )
    await expect(
      planDomain(directory, { ...config, table: "projects" })
    ).rejects.toThrow("database table already exists")
    expect(
      await readFile(
        join(directory, "packages/permissions/src/index.ts"),
        "utf8"
      )
    ).toBe(before)
  })
  it("does not overwrite concurrent changes, symbolic links or invalid registration shapes", async () => {
    const directory = await fixture()
    const plan = await planDomain(directory, config)
    await writeFile(
      join(directory, "packages/contracts/src/index.ts"),
      "// concurrent change\n"
    )
    await expect(writePlan(plan)).rejects.toThrow("changed after planning")
    expect(
      await readFile(join(directory, "packages/contracts/src/index.ts"), "utf8")
    ).toBe("// concurrent change\n")
    await expect(
      lstat(join(directory, "apps/api/src/labels"))
    ).rejects.toHaveProperty("code", "ENOENT")
    await symlink(
      join(directory, "packages/database/src/schema/projects.ts"),
      join(directory, "packages/database/src/schema/labels.ts")
    )
    await expect(planDomain(directory, config)).rejects.toThrow("symbolic link")
  })
  it("rolls back all source writes when formal migration generation fails", async () => {
    const directory = await fixture()
    const plan = await planDomain(directory, config)
    const before = await readFile(
      join(directory, "packages/permissions/src/index.ts"),
      "utf8"
    )
    await expect(
      writePlan(plan, async () => {
        throw new Error("migration generation failed")
      })
    ).rejects.toThrow("migration generation failed")
    expect(
      await readFile(
        join(directory, "packages/permissions/src/index.ts"),
        "utf8"
      )
    ).toBe(before)
    await expect(
      lstat(join(directory, "apps/api/src/labels"))
    ).rejects.toHaveProperty("code", "ENOENT")
    expect(
      (await readdir(directory)).filter((file) =>
        file.startsWith(".domain-scaffold")
      )
    ).toEqual([])
  })
  it("rejects unrelated business Schema drift using a temporary official Drizzle out before publication", async () => {
    const directory = await fixture()
    const journal = join(
      directory,
      "packages/database/migrations/meta/_journal.json"
    )
    const original = await readFile(journal, "utf8")
    const calls: string[][] = []
    await assertSchemaCurrent(
      directory,
      async (_root: string, args: string[]) => {
        calls.push(args)
        return { stdout: "No schema changes, nothing to migrate" }
      }
    )
    expect(calls[0]).toEqual(["db:check"])
    expect(calls[1]?.slice(0, 5)).toEqual([
      "--filter",
      "@workspace/database",
      "exec",
      "drizzle-kit",
      "generate",
    ])
    const plan = await planDomain(directory, config)
    await expect(
      writePlan(
        plan,
        async () => {},
        async () =>
          assertSchemaCurrent(
            directory,
            async (_root: string, args: string[]) => {
              const option = args.find((arg) => arg.startsWith("--config="))
              if (!option) return
              const text = await readFile(
                option.slice("--config=".length),
                "utf8"
              )
              const probe = JSON.parse(text.slice("module.exports = ".length))
              expect(probe.schema).toBe(
                join(directory, "packages/database/src/schema/*.ts")
              )
              await writeFile(
                join(
                  directory,
                  "packages/database",
                  probe.out,
                  "meta/_journal.json"
                ),
                JSON.stringify({ entries: [{ tag: "unrelated_changes" }] })
              )
            }
          )
      )
    ).rejects.toThrow("existing business Schema drift")
    expect(await readFile(journal, "utf8")).toBe(original)
    await expect(
      lstat(join(directory, "packages/database/src/schema/labels.ts"))
    ).rejects.toHaveProperty("code", "ENOENT")
    expect(
      (await readdir(join(directory, "packages/database"))).filter((file) =>
        file.startsWith(".domain-scaffold-probe-")
      )
    ).toEqual([])
  })
  it("does not treat Drizzle zero exit without a no-change confirmation as a clean baseline", async () => {
    const directory = await fixture()
    await expect(
      assertSchemaCurrent(directory, async () => ({
        stdout: "Error: snapshot could not be loaded",
      }))
    ).rejects.toThrow("did not confirm a clean Schema")
  })
  it("uses official migration numbering, writes RLS and restores the ledger on failure", async () => {
    const directory = await fixture()
    const journal = join(
      directory,
      "packages/database/migrations/meta/_journal.json"
    )
    const calls: string[][] = []
    await generateMigrations(
      directory,
      config,
      async (_root: string, args: string[]) => {
        calls.push(args)
        if (args[0] === "db:generate") {
          await writeFile(
            journal,
            JSON.stringify({ entries: [{ tag: "0000_labels" }] })
          )
          await writeFile(
            join(directory, "packages/database/migrations/0000_labels.sql"),
            'CREATE TABLE "labels" (id uuid);'
          )
          return
        }
        await writeFile(
          journal,
          JSON.stringify({
            entries: [{ tag: "0000_labels" }, { tag: "0001_labels-access" }],
          })
        )
        await writeFile(
          join(
            directory,
            "packages/database/migrations/0001_labels-access.sql"
          ),
          "-- custom"
        )
      }
    )
    expect(calls).toEqual([
      ["db:generate"],
      [
        "--filter",
        "@workspace/database",
        "exec",
        "drizzle-kit",
        "generate",
        "--custom",
        "--name=labels-access",
      ],
    ])
    const sql = await readFile(
      join(directory, "packages/database/migrations/0001_labels-access.sql"),
      "utf8"
    )
    expect(sql).toBe(accessSql(config))
    expect(sql).toContain("FORCE ROW LEVEL SECURITY")
    expect(sql).toContain("GRANT SELECT, INSERT, DELETE")
    expect(sql).not.toMatch(/GRANT .*UPDATE|GRANT .*app_migrator/)
    const before = await readFile(journal, "utf8")
    await expect(
      generateMigrations(directory, config, async () => {
        await writeFile(journal, "broken")
        await writeFile(
          join(directory, "packages/database/migrations/0001_partial.sql"),
          "partial"
        )
        throw new Error("drizzle failed")
      })
    ).rejects.toThrow("drizzle failed")
    expect(await readFile(journal, "utf8")).toBe(before)
    await expect(
      lstat(join(directory, "packages/database/migrations/0001_partial.sql"))
    ).rejects.toHaveProperty("code", "ENOENT")
  })
})
