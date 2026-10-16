import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { pipeline } from "node:stream/promises"
import { Transform } from "node:stream"
import { join } from "node:path"
import {
  S3Client,
  paginateListObjectsV2,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3"

// 在发行 API 镜像内执行，复用已锁定的 S3 SDK；对象键从不转换为主机文件路径。
const [operation] = process.argv.slice(2)
const directory = "/backup/objects"
const bucket = process.env.FILES_S3_BUCKET
const configured = process.env.FILES_S3_PREFIX
if (!bucket || configured === undefined)
  throw new Error("S3_SNAPSHOT_CONFIG_REQUIRED")
const prefix = configured ? configured + "/" : ""
const client = new S3Client({
  endpoint: process.env.FILES_S3_ENDPOINT,
  region: process.env.FILES_S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.FILES_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.FILES_S3_SECRET_ACCESS_KEY,
  },
})
async function objects() {
  const result = []
  for await (const page of paginateListObjectsV2(
    { client },
    { Bucket: bucket, Prefix: prefix }
  )) {
    for (const item of page.Contents ?? []) result.push(item.Key)
  }
  return result.sort()
}
try {
  if (operation === "backup") {
    await mkdir(directory, { mode: 0o700 })
    const records = []
    for (const key of await objects()) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      )
      const file = `${records.length}.bin`
      const digest = createHash("sha256")
      await pipeline(
        result.Body,
        new Transform({
          transform(chunk, _encoding, done) {
            digest.update(chunk)
            done(null, chunk)
          },
        }),
        createWriteStream(join(directory, file), { flags: "wx", mode: 0o600 })
      )
      records.push({
        key: key.slice(prefix.length),
        file,
        sha256: digest.digest("hex"),
        contentType: result.ContentType,
        contentEncoding: result.ContentEncoding,
        contentDisposition: result.ContentDisposition,
        cacheControl: result.CacheControl,
        metadata: result.Metadata,
      })
    }
    await writeFile(
      join(directory, "index.json"),
      JSON.stringify(records, null, 2) + "\n",
      { mode: 0o600 }
    )
  } else if (operation === "restore") {
    if ((await objects()).length)
      throw new Error("S3_RESTORE_NAMESPACE_NOT_EMPTY")
    const records = JSON.parse(
      await readFile(join(directory, "index.json"), "utf8")
    )
    for (const record of records) {
      const path = join(directory, record.file)
      const digest = createHash("sha256")
      for await (const chunk of createReadStream(path)) digest.update(chunk)
      if (digest.digest("hex") !== record.sha256)
        throw new Error("S3_SNAPSHOT_CHECKSUM_MISMATCH")
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: prefix + record.key,
          Body: createReadStream(path),
          ContentType: record.contentType,
          ContentEncoding: record.contentEncoding,
          ContentDisposition: record.contentDisposition,
          CacheControl: record.cacheControl,
          Metadata: record.metadata,
        })
      )
    }
  } else throw new Error("S3_SNAPSHOT_OPERATION_REQUIRED")
} finally {
  client.destroy()
}
