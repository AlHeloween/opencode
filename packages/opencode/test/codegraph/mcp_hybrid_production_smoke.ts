/**
 * Production smoke: Fossil diff → configured Opencode MCP.Service →
 * mcpTouchThenSqlitePack().
 *
 * This deliberately uses the application MCP layer rather than the raw MCP
 * SDK. CodeGraph MCP owns freshness; the production wrapper then reads the
 * bounded readonly SQLite pack. It never runs codegraph sync/index/explore.
 *
 * Usage (from packages/opencode):
 *   bun test/codegraph/mcp_hybrid_production_smoke.ts [from_hash to_hash]
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { MCP } from "../../src/mcp"
import { mcpTouchThenSqlitePack } from "../../src/codegraph/mcp-client"
import { provideInstance } from "../fixture/fixture"

const ROOT = process.env.OPENCODE_ROOT
  ? path.resolve(process.env.OPENCODE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function fossil(args: string[]) {
  const result = spawnSync("fossil", args, { cwd: ROOT, encoding: "utf-8", timeout: 60_000, windowsHide: true })
  return {
    code: result.status ?? 1,
    text: result.stdout.toString(),
    error: result.stderr.toString(),
  }
}

function hashes(args: string[]) {
  if (args.length >= 2) return { from: args[0]!, to: args[1]! }
  const timeline = fossil(["timeline", "-n", "5", "--type", "ci"])
  if (timeline.code !== 0) fail(`fossil timeline failed: ${timeline.error || timeline.text}`)
  const found = timeline.text
    .split("\n")
    .map((line) => line.match(/\[([a-f0-9]{8,40})\]/i)?.[1])
    .filter((hash): hash is string => Boolean(hash))
  if (found.length < 2) fail(`need two Fossil snapshots; found ${found.length}`)
  return { from: found[1]!, to: found[0]! }
}

function changedFiles(from: string, to: string) {
  const diff = fossil(["diff", "--from", from, "--to", to, "--brief"])
  if (diff.code !== 0) fail(`fossil diff failed: ${diff.error || diff.text}`)
  const files = diff.text
    .split("\n")
    .map((line) => line.replace(/^[A-Z]+\s+/, "").trim().replaceAll("\\", "/"))
    .filter(Boolean)
  if (!files.length) fail(`fossil diff is empty for ${from} → ${to}`)
  return files
}

async function main() {
  const { from, to } = hashes(process.argv.slice(2))
  const files = changedFiles(from, to)
  console.log(`Fossil range: ${from} → ${to}`)
  console.log(`Changed files (${files.length}): ${files.join(", ")}`)

  const result = await Effect.runPromise(
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        yield* mcp.connect("codegraph")
        const status = yield* mcp.status()
        if (status.codegraph?.status !== "connected") {
          return yield* Effect.fail(new Error(`configured codegraph MCP is not connected: ${JSON.stringify(status.codegraph)}`))
        }
        return yield* mcpTouchThenSqlitePack(ROOT, files)
      }).pipe(Effect.ensuring(mcp.disconnect("codegraph"))),
    ).pipe(Effect.provide(MCP.defaultLayer), provideInstance(ROOT)),
  )
  const outside = result.files.filter((file) => !files.includes(file))
  if (outside.length) fail(`pack escaped Fossil diff scope: ${outside.join(", ")}`)
  if (result.pack.symbols.length + result.pack.crossFileEdges.length === 0) {
    fail("readonly structural pack is empty after a successful MCP touch")
  }
  if (!result.symTag.startsWith("KINDS:")) fail(`invalid structural sym tag: ${result.symTag}`)

  console.log(`MCP text: ${result.mcpText.length} chars (diagnostic only)`)
  console.log(`SQLite pack: ${result.pack.symbols.length} symbols, ${result.pack.crossFileEdges.length} cross-file edges`)
  console.log(`sym tag: ${result.symTag}`)
  console.log("PASS: configured MCP.Service → MCP touch → readonly SQLite structural pack")
}

main().catch((error) => {
  if (error instanceof Error && error.stack) console.error(error.stack)
  fail(error instanceof Error ? error.message : String(error))
})
