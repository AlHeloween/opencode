/**
 * Production smoke: Snapshot.impact() and lastImpact() through the real
 * Fossil sidecar and configured Opencode CodeGraph MCP service.
 *
 * Usage (from packages/opencode):
 *   bun test/codegraph/fossil_hybrid_impact_smoke.ts [from_hash to_hash]
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { MCP } from "../../src/mcp"
import { Snapshot } from "../../src/snapshot"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { provideInstance } from "../fixture/fixture"

const ROOT = process.env.OPENCODE_ROOT
  ? path.resolve(process.env.OPENCODE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function hashes(args: string[]) {
  if (args.length >= 2) return { from: args[0]!, to: args[1]! }
  const result = spawnSync("fossil", ["timeline", "-n", "5", "--type", "ci"], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 60_000,
    windowsHide: true,
  })
  if (result.status !== 0) fail(`fossil timeline failed: ${result.stderr || result.stdout}`)
  const found = result.stdout
    .toString()
    .split("\n")
    .map((line) => line.match(/\[([a-f0-9]{8,40})\]/i)?.[1])
    .filter((hash): hash is string => Boolean(hash))
  if (found.length < 2) fail(`need two Fossil snapshots; found ${found.length}`)
  return { from: found[1]!, to: found[0]! }
}

async function main() {
  const { from, to } = hashes(process.argv.slice(2))
  const result = await Effect.runPromise(
    Snapshot.Service.use((snapshot) =>
      Effect.gen(function* () {
        const impact = yield* snapshot.impact(from, to)
        const last = yield* snapshot.lastImpact()
        return { impact, last }
      }),
    ).pipe(
      Effect.provide(SnapshotFossil.defaultLayer),
      Effect.provide(MCP.defaultLayer),
      provideInstance(ROOT),
    ),
  )

  if (result.impact.changedFiles < 1) fail("Snapshot.impact returned no changed files")
  if (result.impact.topSymbols.length + result.impact.impactedFiles.length === 0) {
    fail("Snapshot.impact returned no structural fields")
  }
  if (result.last.topSymbols.length + Object.keys(result.last.symbolCountByKind).length === 0) {
    fail("Snapshot.lastImpact did not decode the Fossil sym tag")
  }

  console.log(`impact: ${result.impact.changedFiles} changed files, ${result.impact.callerCount} callers`)
  console.log(`last tag: ${Object.keys(result.last.symbolCountByKind).length} kinds, ${result.last.topSymbols.length} top symbols`)
  console.log("PASS: Snapshot impact and Fossil sym-tag decode use configured MCP→SQLite hybrid")
}

main().catch((error) => {
  if (error instanceof Error && error.stack) console.error(error.stack)
  fail(error instanceof Error ? error.message : String(error))
})
