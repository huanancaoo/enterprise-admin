import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

function run(args, cwd = process.cwd(), expectedSuccess = true) {
  const result = spawnSync("i18next-cli", args, { cwd, encoding: "utf8" })
  if (result.error) throw result.error
  assert.equal(
    result.status === 0,
    expectedSuccess,
    `${args.join(" ")}\n${result.stdout}\n${result.stderr}`
  )
  console.log(
    `PASS i18n ${expectedSuccess ? "正常检查" : "拒绝坏输入"}: ${args.join(" ")}`
  )
}

function checkCatalogs(root) {
  const source = JSON.parse(
    readFileSync(path.join(root, "frontend/locales/zh-CN/probe.json"))
  )
  for (const locale of ["zh-CN", "en-US", "ar"]) {
    const catalog = JSON.parse(
      readFileSync(path.join(root, `frontend/locales/${locale}/probe.json`))
    )
    assert.deepEqual(
      Object.keys(catalog).sort(),
      Object.keys(source).sort(),
      `${locale}: keys`
    )
    for (const value of Object.values(catalog))
      assert.ok(
        typeof value === "string" && value.trim().length > 0,
        `${locale}: empty translation`
      )
  }
}

for (const args of [
  ["lint"],
  ["extract", "--ci"],
  ["types", "--ci"],
  ["status"],
])
  run(args)
// CLI status 将源语言空占位视为存在；验收另行要求每个已用 key 的三个语言值均非空。
checkCatalogs(process.cwd())

const cases = [
  [
    "hardcoded",
    "frontend/Probe.tsx",
    (s) => s.replace("<main>", "<main><p>Untranslated text</p>"),
    ["lint"],
  ],
  [
    "catalog-drift",
    "frontend/Probe.tsx",
    (s) =>
      s
        .replace("t('title')", "t('newKey')")
        .replace('t("title")', 't("newKey")'),
    ["extract", "--ci"],
  ],
  [
    "type-drift",
    "frontend/locales/zh-CN/probe.json",
    (s) => JSON.stringify({ ...JSON.parse(s), added: "新字段" }),
    ["types", "--ci"],
  ],
  [
    "missing",
    "frontend/locales/ar/probe.json",
    (s) => {
      const p = JSON.parse(s)
      delete p.loaded
      return JSON.stringify(p)
    },
    ["status"],
  ],
]
mkdirSync(".artifacts", { recursive: true })
for (const [name, file, mutate, args] of cases) {
  const directory = mkdtempSync(path.resolve(".artifacts", `i18n-${name}-`))
  try {
    cpSync("frontend", path.join(directory, "frontend"), { recursive: true })
    cpSync("i18next.config.ts", path.join(directory, "i18next.config.ts"))
    run(args, directory)
    const target = path.join(directory, file)
    const before = readFileSync(target, "utf8")
    const after = mutate(before)
    assert.notEqual(before, after, `${name}: fixture was not changed`)
    writeFileSync(target, after)
    run(args, directory, false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
console.log("PASS i18n: lint/catalog/type/missing-translation 正反向检查")
