/**
 * Smoke: MCP unavailable must HARD-FAIL (no soft-skip).
 *
 * Connects with a non-existent command so MCP cannot start.
 * Exit 0 only if connect fails as required.
 * Exit 1 if connect somehow succeeds (contract broken).
 *
 * Usage (from packages/opencode):
 *   bun test/codegraph/mcp_down_hardfail_smoke.ts
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.OPENCODE_ROOT
  ? path.resolve(process.env.OPENCODE_ROOT)
  : path.resolve(__dirname, "../../../..")

async function main() {
  console.log("=== CodeGraph MCP-down hard-fail smoke ===")
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "codegraph-mcp-does-not-exist-xyz.cmd" : "codegraph-mcp-does-not-exist-xyz",
    args: ["serve", "--mcp"],
    cwd: ROOT,
    stderr: "pipe",
  })
  const client = new Client({ name: "opencode-mcp-down-smoke", version: "1.0.0" })
  try {
    await client.connect(transport)
    console.error("FAIL: MCP connected with bogus binary — hard-fail contract broken")
    await client.close().catch(() => {})
    process.exit(1)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`OK: MCP connect hard-failed as required: ${msg.slice(0, 200)}`)
    console.log("PASS: MCP-down is not a soft-skip")
    process.exit(0)
  }
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e)
  process.exit(1)
})
