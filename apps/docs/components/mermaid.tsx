"use client"

import { useEffect, useId, useState } from "react"

export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replaceAll(":", "")
  const [svg, setSvg] = useState("")

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const mermaid = (await import("mermaid")).default
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict" })
      const { svg: rendered } = await mermaid.render(`mermaid-${id}`, chart)
      if (!cancelled) setSvg(rendered)
    })()

    return () => {
      cancelled = true
    }
  }, [chart, id])

  if (!svg) return null
  return (
    <div className="fd-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
  )
}
