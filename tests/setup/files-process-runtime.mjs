import { createRequire } from "node:module"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { resolve } from "node:path"

const require = createRequire(resolve("apps/api/package.json"))
const {
  createApplication,
} = require("../../apps/api/dist/create-application.js")
const { FilesRuntime } = require("../../apps/api/dist/files/files-runtime.js")
const {
  FileMaintenance,
} = require("../../apps/api/dist/files/file-maintenance.js")
const config = JSON.parse(process.env.FILES_PROCESS_CONFIG)
let app

async function pause(stage, method, arguments_) {
  let gate
  try {
    gate = JSON.parse(await readFile("/tmp/files-gate.json", "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return
    throw error
  }
  const address = arguments_[method === "copy" ? 1 : 0]
  if (
    gate.stage !== stage ||
    gate.method !== method ||
    JSON.stringify(gate.address) !== JSON.stringify(address)
  )
    return
  await writeFile(
    "/tmp/files-gate-hit.json",
    JSON.stringify({ stage, method, address, pid: process.pid })
  )
  // 真实 I/O 已执行的 after gate 只丢失返回；由 SIGKILL 终止进程，不能用异常进入正常 handoff。
  await new Promise(() => {})
}

try {
  await writeFile("/tmp/files-api-pid", String(process.pid))
  if (config.files.kind === "local")
    await mkdir(config.files.root, { recursive: true, mode: 0o700 })
  app = await createApplication(config, { logger: false })
  const storage = app.get(FilesRuntime).requireStorage()
  for (const method of ["copy", "remove"]) {
    const original = storage[method].bind(storage)
    storage[method] = async (...arguments_) => {
      await pause("before", method, arguments_)
      const result = await original(...arguments_)
      await pause("after", method, arguments_)
      return result
    }
  }
  await app.listen(3000, "0.0.0.0")
  app.get(FileMaintenance).start()
  console.log("FILES_PROCESS_API_READY")
} catch (error) {
  console.error(error.code ?? error.message)
  await app?.close()
  process.exitCode = 1
}
