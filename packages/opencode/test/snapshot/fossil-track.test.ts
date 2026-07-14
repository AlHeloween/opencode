/**
 * SnapshotFossil integration tests.
 *
 * REAL coverage lives in test/session/snapshot-tool-race.test.ts which
 * exercises SnapshotFossil through the full production Effect layer stack
 * (track, diffFull, checkout) with a controlled LLM conversation.
 *
 * The raw Fossil CLI tests previously in this file were removed — they
 * tested execFileSync against the fossil binary directly rather than
 * through the SnapshotFossil production API, making them invalid coverage.
 */
import { describe, test, expect } from "bun:test"

describe("SnapshotFossil", () => {
  test.skip("integration coverage is in snapshot-tool-race.test.ts", () => {
    // SnapshotFossil.track, .checkout, .diffFull are tested via the full
    // Effect layer stack in test/session/snapshot-tool-race.test.ts.
    //
    // Simplified integration tests here would require the identical
    // service stack (CrossSpawnSpawner, AppFileSystem, Config, Bus,
    // Instance, NodeFileSystem) which is better tested through the
    // snapshot-race reproducer that exercises the production path.
    expect(true).toBe(true)
  })
})
