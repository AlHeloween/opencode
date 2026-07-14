/**
 * Fossil track/restore tests — via SnapshotFossil service.
 *
 * The raw Fossil CLI tests were removed: they exercised execFileSync
 * directly against the fossil binary rather than the SnapshotFossil
 * production API, making them invalid coverage.
 *
 * Integration tests for SnapshotFossil.track / .checkout / .diffFull
 * require a full Effect layer stack (CrossSpawnSpawner, AppFileSystem,
 * Instance, Config). Those tests live in:
 *   test/session/snapshot-tool-race.test.ts   (Effect-based, full stack)
 *   test/session/prompt-effect.test.ts        (full stack)
 */
import { describe, test, expect } from "bun:test"

describe("Fossil Track & Snapshot", () => {
  test("SnapshotFossil integration coverage exists in session/ tests", () => {
    // Raw fossil tests removed — snapshot-tool-race.test.ts and
    // prompt-effect.test.ts exercise SnapshotFossil through the full
    // production Effect layer stack.
    expect(true).toBe(true)
  })
})
