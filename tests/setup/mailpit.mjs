export function firstHttpUrl(html) {
  const match = html.match(/https?:\/\/[^"\s<]+/)
  if (!match) throw new Error("missing url")
  // href 经 escapeHtml，查询串里的 & 写成 &amp;；浏览器点开会解码，测试取原文必须还原。
  return match[0]
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
}

export async function waitForMail(origin, address, subject) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const list = await fetch(`${origin}/api/v1/messages`)
    const body = await list.json()
    const hit = body.messages?.find(
      (message) =>
        message.To?.some((to) => to.Address === address) &&
        message.Subject === subject
    )
    if (hit) {
      const detail = await fetch(`${origin}/api/v1/message/${hit.ID}`)
      return detail.json()
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`missing mail for ${address}: ${subject}`)
}
