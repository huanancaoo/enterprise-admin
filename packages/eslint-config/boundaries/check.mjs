import { readFileSync, readdirSync, realpathSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

// 白名单约束整个包依赖图，避免前端通过共享包间接取得服务端代码。
const allowed = {
  "apps/tenant": [
    "packages/ui",
    "packages/admin",
    "packages/contracts",
    "packages/api-client",
    "packages/permissions",
    "packages/i18n",
    "packages/mocks",
  ],
  "apps/platform": [
    "packages/ui",
    "packages/admin",
    "packages/contracts",
    "packages/api-client",
    "packages/permissions",
    "packages/i18n",
    "packages/mocks",
  ],
  "apps/storybook": [
    "packages/ui",
    "packages/admin",
    "packages/contracts",
    "packages/api-client",
    "packages/permissions",
    "packages/i18n",
    "packages/mocks",
  ],
  "apps/docs": [],
  "apps/api": [
    "packages/contracts",
    "packages/database",
    "packages/permissions",
    "packages/i18n",
  ],
  "packages/ui": [],
  "packages/admin": [
    "packages/ui",
    "packages/api-client",
    "packages/contracts",
    "packages/permissions",
    "packages/i18n",
  ],
  "packages/contracts": [],
  "packages/api-client": ["packages/contracts"],
  "packages/database": ["packages/permissions"],
  "packages/permissions": [],
  "packages/i18n": [],
  "packages/mocks": ["packages/contracts"],
}
const configs = ["packages/eslint-config", "packages/typescript-config"]
// 这些工程不受业务层依赖矩阵约束，但仍参与依赖目标识别。
const exemptions = {
  ".": "仓库级构建、生成与验证工具",
  "packages/eslint-config": "共享 ESLint 配置",
  "packages/typescript-config": "共享 TypeScript 配置",
}

function discoverWorkspace(root) {
  // 由 pnpm 解释 workspace glob、排除项及嵌套目录，不另维护包清单。
  return JSON.parse(
    execFileSync("pnpm", ["list", "--recursive", "--depth", "-1", "--json"], {
      cwd: root,
      encoding: "utf8",
    })
  ).map((pkg) => ({
    name: pkg.name,
    path: relative(root, pkg.path) || ".",
  }))
}

function* files(dir, packageRoots) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      ["node_modules", "dist", ".turbo", "coverage", ".next", ".source"].includes(
        entry.name
      )
    )
      continue
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (!packageRoots.has(path)) yield* files(path, packageRoots)
    } else if (/\.[cm]?[jt]sx?$/.test(path)) yield path
  }
}
export function checkBoundaries(root) {
  root = realpathSync(root)
  const workspace = discoverWorkspace(root)
  // 嵌套 workspace 的文件归最近的包所有，不能误归给父包。
  const packages = workspace
    .map((pkg) => pkg.path)
    .sort((a, b) => b.length - a.length)
  const packageRoots = new Set(packages.map((pkg) => resolve(root, pkg)))
  const names = new Map(
    workspace.filter((pkg) => pkg.name).map((pkg) => [pkg.name, pkg.path])
  )
  const errors = []
  for (const pkg of packages) {
    if (!Object.hasOwn(allowed, pkg) && !Object.hasOwn(exemptions, pkg))
      errors.push(
        `${pkg}/package.json: workspace package has no dependency boundary policy`
      )
  }
  for (const owner of packages.filter((path) => path in allowed)) {
    function check(specifier, file, target) {
      target ??= [...names].find(([name]) => {
        if (specifier !== name && !specifier.startsWith(name + "/"))
          return false
        // 同名 npm 包（如 storybook）不是本地应用；显式版本依赖以解析路径为准。
        const version =
          manifest.dependencies?.[name] ??
          manifest.devDependencies?.[name] ??
          manifest.peerDependencies?.[name] ??
          manifest.optionalDependencies?.[name]
        return version === undefined || /^(workspace|file|link):/.test(version)
      })?.[1]
      if (target === owner || target === "." || configs.includes(target)) return
      const serverDependency =
        /^(drizzle-orm|drizzle-kit|pg|@nestjs\/[^/]+)(\/|$)/.test(specifier)
      if (
        (target && !allowed[owner].includes(target)) ||
        (serverDependency && !["apps/api", "packages/database"].includes(owner))
      ) {
        errors.push(
          `${relative(root, file)}: ${specifier} violates ${owner} dependency boundary`
        )
      }
    }
    const manifestPath = resolve(root, owner, "package.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    for (const section of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      for (const name of Object.keys(manifest[section] ?? {}))
        check(name, manifestPath)
    }
    const configPath = ts.findConfigFile(
      resolve(root, owner),
      ts.sys.fileExists
    )
    const options = configPath
      ? ts.parseJsonConfigFileContent(
          ts.readConfigFile(configPath, ts.sys.readFile).config,
          ts.sys,
          dirname(configPath)
        ).options
      : {}
    for (const file of files(resolve(root, owner), packageRoots)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true
      )
      function visit(node) {
        let specifier
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          specifier = node.moduleSpecifier.text
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            node.expression.getText(source) === "require") &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        )
          specifier = node.arguments[0].text
        if (
          ts.isImportTypeNode(node) &&
          ts.isLiteralTypeNode(node.argument) &&
          ts.isStringLiteral(node.argument.literal)
        )
          specifier = node.argument.literal.text
        if (specifier) {
          const resolved = ts.resolveModuleName(
            specifier,
            file,
            options,
            ts.sys
          ).resolvedModule?.resolvedFileName
          const path = resolved
            ? relative(root, resolved)
            : specifier.startsWith(".")
              ? relative(root, resolve(dirname(file), specifier))
              : ""
          const target =
            path &&
            !path.startsWith("../") &&
            !path.split("/").includes("node_modules")
              ? packages.find(
                  (pkg) =>
                    pkg === "." || path === pkg || path.startsWith(pkg + "/")
                )
              : undefined
          // 租户 Repository 的连接只能由 TenantTx 参数传入，禁止导入连接工厂或其他执行入口。
          if (
            relative(root, file).startsWith(
              "packages/database/src/repositories/"
            ) &&
            !(
              specifier === "drizzle-orm" ||
              path.startsWith("packages/database/src/schema/") ||
              (path === "packages/database/src/tenant.ts" &&
                ((ts.isImportDeclaration(node) &&
                  node.importClause?.isTypeOnly) ||
                  ts.isImportTypeNode(node)))
            )
          )
            errors.push(
              `${relative(root, file)}: ${specifier} violates TenantTx repository boundary`
            )
          check(specifier, file, target)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  return errors
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = checkBoundaries(process.cwd())
  if (errors.length) {
    console.error(errors.join("\n"))
    process.exitCode = 1
  } else console.log("Workspace dependency boundaries passed")
}
