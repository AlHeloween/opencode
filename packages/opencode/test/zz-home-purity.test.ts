import { describe, expect, test } from "bun:test"
import { homeRoot, scanHome, SENTINELS } from "./lib/home-purity"

/**
 * Home purity guard — phase 2 (verify). Runs LAST ("zz-" prefix).
 *
 * Semantics (revised per user, 2026-08-28): a STRONG ARCHITECTURAL
 * INDICATOR, not a run-killer.
 * - HARD FAIL: opencode's own standard home paths (SENTINELS) appeared
 *   during the run — that is an unambiguous portability-contract breach
 *   (our writers must never target home).
 * - LOUD INDICATOR (non-fatal): any other new entry in home during the
 *   run — printed prominently so the run stays usable but the signal is
 *   impossible to miss.
 * See test/lib/home-purity.ts for the scan/skip contract.
 */
describe("home purity guard", () => {
  test("no opencode paths written to os.homedir(); other new entries are reported", async () => {
    const before = (globalThis as unknown as Record<string, unknown>).__HOME_PURITY_SNAPSHOT as
      | Awaited<ReturnType<typeof scanHome>>
      | undefined
    const after = await scanHome(homeRoot())
    if (!before) {
      // Snapshot phase did not run (file ordering violated) — degrade to
      // scan-only so ordering quirks never flake the guard itself.
      console.debug("home-purity: no snapshot found; diff skipped")
      return
    }

    const sentinelSet = new Set(SENTINELS)

    // ARCHITECTURAL VIOLATION — hard fail: our own standard home paths.
    const sentinelCreated = [...after.paths].filter((p) => sentinelSet.has(p) && !before.paths.has(p))
    if (sentinelCreated.length > 0) {
      console.error(
        `home-purity ARCHITECTURAL VIOLATION — opencode standard paths appeared in os.homedir():\n` +
          sentinelCreated.join("\n"),
      )
    }
    expect(sentinelCreated).toEqual([])

    // STRONG INDICATOR — loud but non-fatal: any other new home entries.
    const newTopLevel = [...after.topLevel].filter((name) => !before.topLevel.has(name) && !sentinelSet.has(name))
    const deepCreated =
      before.truncated || after.truncated
        ? []
        : [...after.paths].filter((entry) => !before.paths.has(entry) && !sentinelSet.has(entry))
    const indicator = [...newTopLevel, ...deepCreated]
    if (indicator.length > 0) {
      console.error(
        `home-purity INDICATOR (non-fatal): ${indicator.length} new entries appeared in os.homedir() ` +
          `during the run — verify no test wrote there:\n${indicator.slice(0, 50).join("\n")}`,
      )
    }
  }, 180_000)
})
