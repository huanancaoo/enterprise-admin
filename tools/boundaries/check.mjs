import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

// 白名单约束整个包依赖图，避免前端通过共享包间接取得服务端代码。
const allowed = {
  "apps/admin": [
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
  "packages/database": [],
  "packages/permissions": [],
  "packages/i18n": [],
  "packages/mocks": ["packages/contracts"],
}
const configs = ["packages/eslint-config", "packages/typescript-config"]
function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".turbo", "coverage"].includes(entry.name))
      continue
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (/\.[cm]?[jt]sx?$/.test(path)) yield path
  }
}
export function checkBoundaries(root) {
  const packages = Object.keys(allowed)
    .concat(configs)
    .filter((path) => existsSync(resolve(root, path, "package.json")))
  const names = new Map(
    packages.map((path) => [
      JSON.parse(readFileSync(resolve(root, path, "package.json"), "utf8"))
        .name,
      path,
    ])
  )
  const errors = []
  for (const owner of packages.filter((path) => path in allowed)) {
    function check(specifier, file, target) {
      target ??= [...names].find(
        ([name]) => specifier === name || specifier.startsWith(name + "/")
      )?.[1]
      if (target === owner || configs.includes(target)) return
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
    for (const file of files(resolve(root, owner))) {
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
          const target = packages.find((pkg) => path.startsWith(pkg + "/"))
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
