// The robot in miniature: start a local stdio MCP server through the SDK transport, hand it to the exit
// reaper exactly as `connectLocal` does, then leave through `process.exit(1)` — the exit `opencode run` takes
// on a session error, which skips every Effect finalizer (and with them the MCP state's killTree).
import path from "path"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { ExitReaper } from "../../../src/mcp/exit-reaper"

const pidFile = process.argv[2]
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(import.meta.dir, "exit-reaper-server.ts"), pidFile],
  stderr: "ignore",
})
await transport.start()
ExitReaper.track(transport)
while (!(await Bun.file(pidFile).exists())) await Bun.sleep(25)
process.exit(1)
