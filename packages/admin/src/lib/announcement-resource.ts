export function saveAnnouncementResource(reply: {
  data: Blob
  headers: Headers
}) {
  const disposition = reply.headers.get("content-disposition") ?? ""
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  const quoted = /filename="([^"]+)"/i.exec(disposition)?.[1]
  const fileName = encoded ? decodeURIComponent(encoded) : quoted
  if (!fileName) throw new Error("Missing authorized download filename")
  const url = URL.createObjectURL(reply.data)
  try {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = fileName
    anchor.click()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
