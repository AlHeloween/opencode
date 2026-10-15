import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

const control = process.argv[2]!
const server = new Server({ name: "held-graph-fixture", version: "1" }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "codegraph_explore",
      description: "Deterministic graph preparation boundary",
      inputSchema: { type: "object", properties: { query: { type: "string" }, projectPath: { type: "string" } } },
    },
  ],
}))
server.setRequestHandler(CallToolRequestSchema, async () => {
  await fs.writeFile(path.join(control, "entered"), "graph request entered")
  while (!existsSync(path.join(control, "release"))) await Bun.sleep(20)
  return { content: [{ type: "text", text: "# CodeGraph fixture\nThe preparation request completed." }] }
})
await server.connect(new StdioServerTransport())
