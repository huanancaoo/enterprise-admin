import {
  source,
  descendants,
  initializer,
  property,
  unwrap,
  append,
  apply,
  one,
  ts,
} from "./ast.mjs"
import { catalogs, names, sortCatalog } from "./templates.mjs"
import { locales } from "./config.mjs"

export function register(path, text, input) {
  const {
    entity: e,
    domain: d,
    table,
    Entity: E,
    Domain: D,
    grants,
    delegable,
  } = names(input)
  const ast = source(path, text)
  const edits = []
  const variable = (name) => initializer(ast, name)
  const add = (node, value) => edits.push(append(node, value))
  const prefix = (value) => edits.push({ start: 0, end: 0, value })
  const suffix = (value) =>
    edits.push({
      start: text.length,
      end: text.length,
      value: "\n" + value + "\n",
    })
  if (path === "packages/permissions/src/index.ts") {
    const statements = unwrap(variable("permissionStatements"))
    if (statements.properties.some((node) => node.name?.getText(ast) === e))
      throw new Error(`permission ${e} already exists`)
    prefix(`export const ${e}Actions = ["read", "create", "delete"] as const\n`)
    add(statements, `${e}: ${e}Actions,`)
    if (delegable.length)
      add(
        variable("delegableRolePermissions"),
        `${e}: ${JSON.stringify(delegable)},`
      )
    for (const role of ["owner", "admin", "member"])
      if (grants[role].length)
        add(
          property(
            unwrap(variable("builtInOrganizationRolePermissions")),
            role,
            ast
          ).initializer,
          `${e}: ${JSON.stringify(grants[role])},`
        )
    const request = one(
      descendants(
        ast,
        (node) =>
          ts.isTypeAliasDeclaration(node) &&
          node.name.text === "PermissionRequest"
      ),
      "PermissionRequest"
    )
    add(request.type, `${e}?: (typeof ${e}Actions)[number][]`)
  } else if (path === "apps/api/src/app.module.ts") {
    prefix(`import { ${D}Module } from './${d}/${d}.module';\n`)
    const method = one(
      descendants(
        ast,
        (node) =>
          ts.isMethodDeclaration(node) && node.name.getText(ast) === "forRoot"
      ),
      "AppModule.forRoot"
    )
    const result = one(
      descendants(method, ts.isReturnStatement),
      "AppModule return"
    )
    add(property(result.expression, "imports", ast).initializer, `${D}Module,`)
  } else if (path === "packages/i18n/src/resources.ts") {
    prefix(
      locales
        .map(
          (locale, index) =>
            `import ${d}${index} from "./locales/${locale}/${d}.json" with { type: "json" }`
        )
        .join("\n") + "\n"
    )
    for (const [index, locale] of locales.entries())
      add(
        property(variable("resources"), locale, ast).initializer,
        `${d}: ${d}${index},`
      )
  } else if (path === "packages/i18n/scripts/check-catalogs.mjs") {
    add(variable("namespaces"), JSON.stringify(d) + ",")
  } else if (path === "apps/tenant/src/router.tsx") {
    prefix(`import { ${E}ListQuerySchema } from "@workspace/contracts"\n`)
    const router = one(
      descendants(
        ast,
        (node) =>
          ts.isVariableStatement(node) &&
          node.declarationList.declarations.some(
            (item) => item.name.getText(ast) === "router"
          )
      ),
      "router"
    )
    edits.push({
      start: router.getStart(ast),
      end: router.getStart(ast),
      value: `const ${D}Route = lazyRouteComponent(() => import("./features/${d}/${d}-route"), "${D}Route")\nconst ${d}LayoutRoute = createRoute({ getParentRoute: () => appRoute, path: "/${d}", component: AdminLayout })\nconst ${d}Route = createRoute({ getParentRoute: () => ${d}LayoutRoute, path: "/$organizationId", validateSearch: ${E}ListQuerySchema, component: ${D}Route })\n`,
    })
    const children = one(
      descendants(
        router,
        (node) =>
          ts.isCallExpression(node) &&
          node.expression.getText(ast) === "appRoute.addChildren"
      ),
      "appRoute.addChildren"
    )
    add(children.arguments[0], `${d}LayoutRoute.addChildren([${d}Route]),`)
  } else if (path === "apps/tenant/src/components/admin-layout.tsx") {
    const trans = one(
      descendants(
        ast,
        (node) =>
          ts.isCallExpression(node) &&
          node.expression.getText(ast) === "useTranslation"
      ),
      "AdminLayout translation"
    )
    add(trans.arguments[0], JSON.stringify(d) + ",")
    const onFiles = one(
      descendants(
        ast,
        (node) =>
          ts.isVariableDeclaration(node) && node.name.getText(ast) === "onFiles"
      ),
      "onFiles"
    )
    edits.push({
      start: onFiles.parent.parent.end,
      end: onFiles.parent.parent.end,
      value: `\nconst on${D} = pathname.startsWith("/app/${d}/")\nconst ${e}Link = currentOrganizationId ? <Link to="/app/${d}/$organizationId" params={{ organizationId: currentOrganizationId }} search={{ page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" }} /> : undefined\n`,
    })
    const select = one(
      descendants(
        ast,
        (node) =>
          ts.isFunctionDeclaration(node) &&
          node.name?.text === "selectOrganization"
      ),
      "selectOrganization"
    )
    const before = one(
      select.body.statements.filter(
        (node) =>
          ts.isIfStatement(node) &&
          node.expression.getText(ast) === "onAnnouncements"
      ),
      "organization switch"
    )
    edits.push({
      start: before.getStart(ast),
      end: before.getStart(ast),
      value: `if (on${D}) { await navigate({ to: "/app/${d}/$organizationId", params: { organizationId: nextOrganizationId }, search: { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" } }); return }\n`,
    })
    const breadcrumb = one(
      descendants(
        ast,
        (node) =>
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText(ast) === "BreadcrumbPage"
      ),
      "BreadcrumbPage"
    )
    const expression = one(
      breadcrumb.children.filter(ts.isJsxExpression),
      "breadcrumb expression"
    ).expression
    edits.push({
      start: expression.getStart(ast),
      end: expression.end,
      value: `on${D} ? t("${d}:title") : (${expression.getText(ast)})`,
    })
    const sidebar = one(
      descendants(
        ast,
        (node) =>
          ts.isJsxAttribute(node) && node.name.getText(ast) === "sidebar"
      ),
      "sidebar"
    )
    add(
      property(
        property(sidebar.initializer.expression, "navigation", ast).initializer,
        "items",
        ast
      ).initializer,
      `{ title: t("${d}:title"), icon: <FolderKanbanIcon />, isActive: on${D}, disabled: !currentOrganizationId || suspended, render: ${e}Link },`
    )
    const created = one(
      descendants(
        ast,
        (node) =>
          ts.isJsxAttribute(node) && node.name.getText(ast) === "onCreated"
      ),
      "organization onCreated"
    )
    const target = one(
      descendants(
        created,
        (node) =>
          ts.isPropertyAssignment(node) && node.name.getText(ast) === "to"
      ),
      "onCreated target"
    ).initializer
    edits.push({
      start: target.getStart(ast),
      end: target.end,
      value: `on${D} ? "/app/${d}/$organizationId" : (${target.getText(ast)})`,
    })
    const projectSearch = variable("projectListSearch")
    if (!ts.isConditionalExpression(projectSearch))
      throw new Error("projectListSearch must have an explicit condition")
    edits.push({
      start: projectSearch.condition.getStart(ast),
      end: projectSearch.condition.end,
      value: `!on${D} && (${projectSearch.condition.getText(ast)})`,
    })
  } else if (path === "apps/tenant/src/components/roles-route.tsx") {
    add(
      variable("permissionLabelKeys"),
      ["read", "create", "delete"]
        .map(
          (action) =>
            `${JSON.stringify(`${e}:${action}`)}: ${JSON.stringify(`rolePermission_${e}_${action}`)},`
        )
        .join("\n")
    )
  } else if (path === "packages/database/test/database.test.ts") {
    add(variable("tables"), JSON.stringify(table) + ",")
  } else if (path === "packages/contracts/src/index.ts") {
    suffix(`export * from "./${d}.js"`)
  } else if (path === "packages/mocks/src/index.ts") {
    suffix(`export { create${D}Scenario } from "./handlers/${d}"`)
  } else if (path === "packages/api-client/src/index.ts") {
    suffix(
      `export { list${D}, create${E}, delete${E} } from "./generated/endpoints/${d}/${d}"`
    )
  } else throw new Error(`unregistered integration path: ${path}`)
  const result = apply(text, edits)
  source(path, result)
  return result
}

export const integrationPaths = [
  "packages/mocks/src/index.ts",
  "packages/permissions/src/index.ts",
  "apps/api/src/app.module.ts",
  "packages/i18n/src/resources.ts",
  "packages/i18n/scripts/check-catalogs.mjs",
  "apps/tenant/src/router.tsx",
  "apps/tenant/src/components/admin-layout.tsx",
  "apps/tenant/src/components/roles-route.tsx",
  "packages/database/test/database.test.ts",
  "packages/contracts/src/index.ts",
  "packages/api-client/src/index.ts",
]
export function registerJson(path, text, input) {
  const { entity: e, domain: d } = input
  const data = JSON.parse(text)
  if (path === "packages/database/package.json") {
    const key = `./repositories/${d}`
    if (Object.hasOwn(data.exports, key))
      throw new Error(`${key} export already exists`)
    data.exports[key] = {
      types: `./dist/repositories/${d}.d.ts`,
      default: `./dist/repositories/${d}.js`,
    }
  } else {
    const locale = path.split("/").at(-2)
    const text = catalogs(input)[locale]
    for (const action of ["read", "create", "delete"]) {
      const key = `rolePermission_${e}_${action}`
      if (Object.hasOwn(data, key))
        throw new Error(`${key} translation already exists`)
      const label =
        text[`permission${action[0].toUpperCase()}${action.slice(1)}`]
      data[key] = `${input.labels[locale].title} · ${label}`
    }
  }
  return (
    JSON.stringify(
      path === "packages/database/package.json" ? data : sortCatalog(data),
      null,
      2
    ) + "\n"
  )
}
