import { createMcpHandler, McpServer } from "@modelcontextprotocol/server"
import { registerSearchTool, registerSourceTools } from "fumadocs-core/mcp"
import { createFromSource } from "fumadocs-core/search/server"
import { docsLlms, source } from "@/lib/source"

const handler = createMcpHandler(() => {
  const mcp = new McpServer({
    name: "docs",
    version: "1.0.0",
  })

  registerSourceTools(mcp, source, docsLlms)
  registerSearchTool(mcp, createFromSource(source))

  return mcp
})

export const GET = (request: Request) => handler.fetch(request)
export const POST = (request: Request) => handler.fetch(request)
export const DELETE = (request: Request) => handler.fetch(request)
