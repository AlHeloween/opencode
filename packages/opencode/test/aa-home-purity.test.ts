import { describe, expect, test } from "bun:test"
import { homeRoot, scanHome } from "./lib/home-purity"

/**
 * Home purity guard — phase 1 (snapshot).
 *
 * File name starts with "aa-" so bun's alphabetical discovery runs it
 * before the rest of the suite. It snapshots the real user home so that
 * test/zz-home-purity.test.ts (runs last) can diff and fail the WHOLE
 * run if anything appeared in os.homedir() during the run.
 */
describe("home purity guard (snapshot phase)", () => {
  test("snapshot os.homedir() before the suite", async () => {
    const snapshot = await scanHome(homeRoot())
    ;(globalThis as unknown as Record<string, unknown>).__HOME_PURITY_SNAPSHOT = snapshot
    expect(snapshot.topLevel.size).toBeGreaterThan(0)
  }, 180_000)
})
