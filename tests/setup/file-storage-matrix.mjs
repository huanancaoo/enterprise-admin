import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"

const payload = Buffer.from("合同 2026 / مرحبا\n\u0000\xff", "utf8")
const facts = (bytes) => ({
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
})
async function* chunks(bytes) {
  yield bytes.subarray(0, 4)
  yield bytes.subarray(4)
}
async function bytes(storage, address, range) {
  const read = await storage.open(address, range)
  const content = []
  for await (const chunk of read.body) content.push(chunk)
  return { ...read, body: Buffer.concat(content) }
}
const rejects = (operation, code) => assert.rejects(operation, { code })

// 同一生产接口、同一组可观察结果，分别连接 Linux Local 与真实 RustFS。
export function registerFileStorageMatrix(test, fixture) {
  function scenario(name, run) {
    test(name, async () => {
      const owner = { kind: "organization", id: randomUUID() }
      const at = (...segments) => ({ owner, area: "files", segments })
      await fixture.storage.createDirectory(at())
      await run({ ...fixture, at, owner })
    })
  }

  scenario(
    "归属根区可重复初始化并保留既有文件，确切目录查询不创建缺失路径",
    async ({ storage, at, owner, inspectContent, inspectDirectory }) => {
      await storage.write(at("保留.bin"), chunks(payload), payload.length)
      await storage.ensureOwner(owner)
      await storage.ensureOwner(owner)
      for (const area of ["files", "history", "trash", "staging"]) {
        const root = { owner, area, segments: [] }
        assert.equal(await storage.directoryExists(root), true)
        assert.equal(await inspectDirectory(root), true)
      }
      assert.deepEqual(await inspectContent(at("保留.bin")), payload)
      assert.equal(await storage.directoryExists(at("缺失")), false)
      assert.equal(await inspectDirectory(at("缺失")), false)
      await storage.createDirectory(at("重启恢复"))
      assert.equal(await storage.directoryExists(at("重启恢复")), true)
      await rejects(
        () => storage.createDirectory(at("重启恢复")),
        "STORAGE_CONFLICT"
      )
    }
  )

  scenario(
    "个人根区与组织根区独立初始化且不复用同名归属",
    async ({ storage, owner, at, inspectContent }) => {
      const personal = { kind: "personal", id: owner.id }
      await storage.ensureOwner(personal)
      const target = { owner: personal, area: "files", segments: ["same"] }
      await storage.write(target, chunks(payload), payload.length)
      const other = Buffer.from("组织内容")
      await storage.write(at("same"), chunks(other), other.length)
      await storage.ensureOwner(personal)
      await storage.ensureOwner(owner)
      assert.deepEqual(await inspectContent(target), payload)
      assert.deepEqual(await inspectContent(at("same")), other)
    }
  )

  scenario(
    "空目录和多级目录对应真实物理路径，重复创建不覆盖",
    async ({ storage, at, inspectDirectory }) => {
      await storage.createDirectory(at("合同"))
      await storage.createDirectory(at("合同", "2026"))
      assert.equal(await inspectDirectory(at("合同", "2026")), true)
      await rejects(
        () => storage.createDirectory(at("合同")),
        "STORAGE_CONFLICT"
      )
    }
  )

  scenario(
    "根目录不能移除，原物理目录保留",
    async ({ storage, at, inspectDirectory }) => {
      await rejects(
        () => storage.removeDirectory(at()),
        "STORAGE_ROOT_PROTECTED"
      )
      assert.equal(await inspectDirectory(at()), true)
    }
  )

  scenario(
    "上传按界面层级落位，中文阿拉伯语空格与 NFC 字节正确",
    async ({ storage, at, inspectContent }) => {
      await storage.createDirectory(at("合同"))
      await storage.createDirectory(at("合同", "مرحبا 2026"))
      const address = at("合同", "مرحبا 2026", " e\u0301 50%.bin ")
      assert.deepEqual(
        await storage.write(address, chunks(payload), payload.length),
        facts(payload)
      )
      assert.deepEqual(
        await inspectContent(at("合同", "مرحبا 2026", "é 50%.bin")),
        payload
      )
      assert.deepEqual((await bytes(storage, address)).body, payload)
    }
  )

  scenario("同级名称区分大小写", async ({ storage, at, inspectContent }) => {
    await storage.write(at("A.bin"), chunks(payload), payload.length)
    const other = Buffer.from("另一个文件")
    await storage.write(at("a.bin"), chunks(other), other.length)
    assert.deepEqual(await inspectContent(at("A.bin")), payload)
    assert.deepEqual(await inspectContent(at("a.bin")), other)
  })

  scenario(
    "246 字节目录、255 字节文件名和完整 512 字节相对路径可实际保存",
    async ({ storage, at, inspectContent }) => {
      const fileName = "f".repeat(255)
      await storage.write(at(fileName), chunks(payload), payload.length)
      assert.deepEqual(await inspectContent(at(fileName)), payload)
      const parent = ["a".repeat(246), "b".repeat(9)]
      await storage.createDirectory(at(parent[0]))
      await storage.createDirectory(at(...parent))
      const address = at(...parent, "c".repeat(255))
      await storage.write(address, chunks(payload), payload.length)
      assert.deepEqual(await inspectContent(address), payload)
      await storage.copy(address, at("g".repeat(255)), facts(payload))
      assert.deepEqual(await inspectContent(at("g".repeat(255))), payload)
    }
  )

  scenario(
    "超出目录预算的名称在两种存储都明确拒绝",
    async ({ storage, at }) => {
      await rejects(
        () => storage.createDirectory(at("a".repeat(247))),
        "FOLDER_NAME_TOO_LONG"
      )
      await rejects(
        () =>
          storage.write(
            at("a".repeat(247), "b"),
            chunks(payload),
            payload.length
          ),
        "FOLDER_NAME_TOO_LONG"
      )
    }
  )

  scenario("普通同名上传拒绝，原内容不变", async ({ storage, at }) => {
    await storage.write(at("a.bin"), chunks(payload), payload.length)
    await rejects(
      () => storage.write(at("a.bin"), chunks(Buffer.from("new")), 3),
      "STORAGE_CONFLICT"
    )
    assert.deepEqual((await bytes(storage, at("a.bin"))).body, payload)
  })

  scenario(
    "并发同名上传只有一个物理结果，不覆盖获胜内容",
    async ({ storage, at, inspectContent }) => {
      const other = Buffer.from("并发上传")
      const inputs = [payload, other]
      const results = await Promise.allSettled(
        inputs.map((content) =>
          storage.write(at("same"), chunks(content), content.length)
        )
      )
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1
      )
      const winner = results.findIndex(
        (result) => result.status === "fulfilled"
      )
      assert.deepEqual(results[winner].value, facts(inputs[winner]))
      assert.equal(results[1 - winner].reason.code, "STORAGE_CONFLICT")
      assert.deepEqual(await inspectContent(at("same")), inputs[winner])
    }
  )

  scenario("文件和目录共享同级名称", async ({ storage, at }) => {
    await storage.createDirectory(at("目录"))
    await rejects(
      () => storage.write(at("目录"), chunks(payload), payload.length),
      "STORAGE_CONFLICT"
    )
    await storage.write(at("文件"), chunks(payload), payload.length)
    await rejects(() => storage.createDirectory(at("文件")), "STORAGE_CONFLICT")
  })

  scenario(
    "不存在的父目录拒绝上传及创建，不改投根目录",
    async ({ storage, at, inspectAbsent }) => {
      await rejects(
        () =>
          storage.write(at("已删除", "a.bin"), chunks(payload), payload.length),
        "STORAGE_NOT_FOUND"
      )
      await rejects(
        () => storage.createDirectory(at("已删除", "子目录")),
        "STORAGE_NOT_FOUND"
      )
      assert.equal(await inspectAbsent(at("a.bin")), true)
      assert.equal(await inspectAbsent(at("已删除", "a.bin")), true)
    }
  )

  scenario("零字节文件有完整字节和哈希事实", async ({ storage, at }) => {
    const empty = Buffer.alloc(0)
    assert.deepEqual(
      await storage.write(at("empty.bin"), chunks(empty), 0),
      facts(empty)
    )
    assert.deepEqual((await bytes(storage, at("empty.bin"))).body, empty)
    await rejects(
      () => storage.open(at("empty.bin"), { start: 0, end: 0 }),
      "STORAGE_RANGE_INVALID"
    )
  })

  scenario("实际字节少于声明拒绝，不发布成功事实", async ({ storage, at }) => {
    await rejects(
      () => storage.write(at("short.bin"), chunks(payload), payload.length + 1),
      "STORAGE_LENGTH_MISMATCH"
    )
  })

  scenario("实际字节多于声明拒绝，不发布成功事实", async ({ storage, at }) => {
    await rejects(
      () => storage.write(at("long.bin"), chunks(payload), payload.length - 1),
      "STORAGE_LENGTH_MISMATCH"
    )
  })

  scenario(
    "Range 返回实际范围字节与总长度，末端按 EOF 截断",
    async ({ storage, at }) => {
      await storage.write(at("a.bin"), chunks(payload), payload.length)
      const read = await bytes(storage, at("a.bin"), { start: 2, end: 8 })
      assert.deepEqual(read.body, payload.subarray(2, 9))
      assert.equal(read.bytes, 7)
      assert.equal(read.totalBytes, payload.length)
      assert.deepEqual(read.range, { start: 2, end: 8 })
      const tail = await bytes(storage, at("a.bin"), {
        start: payload.length - 2,
        end: 999,
      })
      assert.deepEqual(tail.body, payload.subarray(-2))
      assert.deepEqual(tail.range, {
        start: payload.length - 2,
        end: payload.length - 1,
      })
    }
  )

  scenario("无效 Range 拒绝", async ({ storage, at }) => {
    await storage.write(at("a.bin"), chunks(payload), payload.length)
    for (const range of [
      { start: -1, end: 2 },
      { start: 3, end: 2 },
      { start: payload.length, end: 999 },
      { start: 0.5, end: 2 },
    ])
      await rejects(
        () => storage.open(at("a.bin"), range),
        "STORAGE_RANGE_INVALID"
      )
  })

  scenario(
    "复制准备并校验目标字节，源保留到显式清理",
    async ({ storage, at, inspectContent, inspectAbsent }) => {
      await storage.createDirectory(at("新目录"))
      await storage.write(at("原文件 50%.bin"), chunks(payload), payload.length)
      await storage.copy(
        at("原文件 50%.bin"),
        at("新目录", "مرحبا.bin"),
        facts(payload)
      )
      assert.deepEqual(await inspectContent(at("新目录", "مرحبا.bin")), payload)
      assert.deepEqual(await inspectContent(at("原文件 50%.bin")), payload)
      await storage.remove(at("原文件 50%.bin"))
      assert.equal(await inspectAbsent(at("原文件 50%.bin")), true)
      assert.deepEqual(
        (await bytes(storage, at("新目录", "مرحبا.bin"))).body,
        payload
      )
    }
  )

  scenario("复制到既有目标拒绝，两边内容均保留", async ({ storage, at }) => {
    const other = Buffer.from("原目标")
    await storage.write(at("source"), chunks(payload), payload.length)
    await storage.write(at("target"), chunks(other), other.length)
    await rejects(
      () => storage.copy(at("source"), at("target"), facts(payload)),
      "STORAGE_CONFLICT"
    )
    assert.deepEqual((await bytes(storage, at("source"))).body, payload)
    assert.deepEqual((await bytes(storage, at("target"))).body, other)
  })

  scenario(
    "并发复制到同一目标只有一个结果，两个源均保留",
    async ({ storage, at, inspectContent }) => {
      const other = Buffer.from("并发复制")
      const inputs = [payload, other]
      for (const [index, content] of inputs.entries())
        await storage.write(
          at(`source-${index}`),
          chunks(content),
          content.length
        )
      const results = await Promise.allSettled(
        inputs.map((content, index) =>
          storage.copy(at(`source-${index}`), at("target"), facts(content))
        )
      )
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1
      )
      const winner = results.findIndex(
        (result) => result.status === "fulfilled"
      )
      assert.equal(results[1 - winner].reason.code, "STORAGE_CONFLICT")
      assert.deepEqual(await inspectContent(at("target")), inputs[winner])
      for (const [index, content] of inputs.entries())
        assert.deepEqual(await inspectContent(at(`source-${index}`)), content)
    }
  )

  scenario(
    "复制校验失败清理本次新目标，源保持原字节",
    async ({ storage, at, inspectAbsent }) => {
      await storage.write(at("source"), chunks(payload), payload.length)
      await rejects(
        () =>
          storage.copy(at("source"), at("target"), {
            ...facts(payload),
            sha256: "0".repeat(64),
          }),
        "STORAGE_CONTENT_MISMATCH"
      )
      assert.equal(await inspectAbsent(at("target")), true)
      assert.deepEqual((await bytes(storage, at("source"))).body, payload)
    }
  )

  scenario(
    "缺失源或目标父目录拒绝复制",
    async ({ storage, at, inspectAbsent }) => {
      await rejects(
        () => storage.copy(at("不存在"), at("target"), facts(payload)),
        "STORAGE_NOT_FOUND"
      )
      await storage.write(at("source"), chunks(payload), payload.length)
      await rejects(
        () =>
          storage.copy(at("source"), at("缺失目录", "target"), facts(payload)),
        "STORAGE_NOT_FOUND"
      )
      assert.equal(await inspectAbsent(at("target")), true)
    }
  )

  scenario(
    "跨组织或跨个人归属复制拒绝",
    async ({ storage, at, inspectContent }) => {
      const source = at("source")
      await storage.write(source, chunks(payload), payload.length)
      for (const owner of [
        { kind: "organization", id: randomUUID() },
        { kind: "personal", id: source.owner.id },
      ])
        await rejects(
          () =>
            storage.copy(source, { ...at("target"), owner }, facts(payload)),
          "STORAGE_OWNER_MISMATCH"
        )
      assert.deepEqual(await inspectContent(source), payload)
    }
  )

  scenario(
    "组织有效区、内部历史区与个人媒体物理隔离",
    async ({ storage, at, owner, inspectContent }) => {
      const history = { owner, area: "history", segments: ["same"] }
      const personal = {
        owner: { kind: "personal", id: owner.id },
        area: "files",
        segments: ["same"],
      }
      await storage.createDirectory({ ...history, segments: [] })
      await storage.createDirectory({ ...personal, segments: [] })
      const old = Buffer.from("历史版本")
      const avatar = Buffer.from("个人媒体")
      await storage.write(at("same"), chunks(payload), payload.length)
      await storage.write(history, chunks(old), old.length)
      await storage.write(personal, chunks(avatar), avatar.length)
      assert.deepEqual(await inspectContent(at("same")), payload)
      assert.deepEqual(await inspectContent(history), old)
      assert.deepEqual(await inspectContent(personal), avatar)
    }
  )

  scenario(
    "删除只触及精确文件，重复清理不触及相邻名称",
    async ({ storage, at, inspectAbsent }) => {
      await storage.write(at("a"), chunks(payload), payload.length)
      await storage.write(at("a-long"), chunks(payload), payload.length)
      await storage.remove(at("a"))
      await storage.remove(at("a"))
      assert.equal(await inspectAbsent(at("a")), true)
      assert.deepEqual((await bytes(storage, at("a-long"))).body, payload)
      await rejects(() => storage.open(at("a")), "STORAGE_NOT_FOUND")
    }
  )

  scenario(
    "非空目录拒绝物理移除，清空后精确移除目录",
    async ({ storage, at, inspectDirectory }) => {
      await storage.createDirectory(at("目录"))
      await storage.createDirectory(at("目录2"))
      await storage.write(at("目录", "a"), chunks(payload), payload.length)
      await rejects(
        () => storage.removeDirectory(at("目录")),
        "STORAGE_DIRECTORY_NOT_EMPTY"
      )
      assert.deepEqual((await bytes(storage, at("目录", "a"))).body, payload)
      await storage.remove(at("目录", "a"))
      await storage.removeDirectory(at("目录"))
      await storage.removeDirectory(at("目录"))
      assert.equal(await inspectDirectory(at("目录")), false)
      assert.equal(await inspectDirectory(at("目录2")), true)
    }
  )

  scenario(
    "重新创建存储模块仍可读原目录与字节",
    async ({ storage, at, reopen, inspectDirectory }) => {
      await storage.createDirectory(at("空目录"))
      await storage.write(at("a.bin"), chunks(payload), payload.length)
      const renewed = await reopen()
      try {
        assert.deepEqual((await bytes(renewed, at("a.bin"))).body, payload)
        assert.equal(await inspectDirectory(at("空目录")), true)
      } finally {
        await renewed[Symbol.asyncDispose]()
      }
    }
  )

  scenario("非法路径段、编码分隔符与超长路径拒绝", async ({ storage, at }) => {
    for (const name of ["..", "x/y", "x\\y", "x%2fy", "x%252fy", "x\u0000y"])
      await rejects(
        () => storage.write(at(name), chunks(payload), payload.length),
        "FILE_NAME_INVALID"
      )
    await rejects(
      () => storage.write(at("中".repeat(86)), chunks(payload), payload.length),
      "FILE_NAME_TOO_LONG"
    )
    await rejects(
      () =>
        storage.write(
          at("a".repeat(246), "b".repeat(246), "c".repeat(19)),
          chunks(payload),
          payload.length
        ),
      "FILE_PATH_TOO_LONG"
    )
    await rejects(() => storage.open(at()), "STORAGE_LOCATION_INVALID")
  })
}
