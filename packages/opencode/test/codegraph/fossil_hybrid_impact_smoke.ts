/**
 * Production smoke: Snapshot.impact() through the real Fossil sidecar and the
 * configured Opencode CodeGraph MCP service, and lastImpact() through the fossil
 * brief + readonly SQLite pack (no MCP, no sym tag).
 *
 * Usage (from packages/opencode):
 *   bun test/codegraph/fossil_hybrid_impact_smoke.ts [from_hash to_hash]
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { MCP } from "../../src/mcp"
import { Snapshot } from "../../src/snapshot"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { provideInstance } from "../fixture/fixture"
import { fossilRange } from "./fossil-sidecar"

const ROOT = process.env.OPENCODE_ROOT
  ? path.resolve(process.env.OPENCODE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function hashes(args: string[]) {
  return fossilRange(ROOT, args)
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
  // lastImpact reads the BRIEF (fossil diff --brief parent → checkout) and the readonly SQLite pack —
  // the `sym` tag it used to decode is written by nobody since C1 (plans/2026-09-29_codegraph-impact-
  // decoupling.md, C5). Its contract: a real checkout hash as `to`, and a brief whose size is a count.
  if (!/^[a-f0-9]{10,}$/.test(result.last.to)) fail(`Snapshot.lastImpact returned no checkout hash: ${result.last.to}`)
  if (!Number.isInteger(result.last.changedFiles) || result.last.changedFiles < 0) {
    fail("Snapshot.lastImpact did not read the fossil brief of the last snapshot")
  }

  console.log(`impact: ${result.impact.changedFiles} changed files, ${result.impact.callerCount} callers`)
  console.log(
    `last snapshot: ${result.last.changedFiles} changed files (${result.last.from.slice(0, 10)} → ${result.last.to.slice(0, 10)}), ${result.last.topSymbols.length} top symbols`,
  )
  console.log("PASS: Snapshot.impact uses the MCP→SQLite hybrid; lastImpact reads the fossil brief + SQLite pack")
}

main().catch((error) => {
  if (error instanceof Error && error.stack) console.error(error.stack)
  fail(error instanceof Error ? error.message : String(error))
})
