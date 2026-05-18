/**
 * Tests for the Pierre selection/diff engine.
 *
 * Pierre handles file selection state, diff rendering, comment
 * hover position, and selection virtualization.
 *
 * Run: bun test
 */
import { describe, test, expect } from "bun:test"

describe("file-selection", () => {
  test.todo("computes selection ranges from patch hunks", () => {
    // TOOD: create FileSelection from a unified diff, verify line ranges
  })

  test.todo("detects adjacent/overlapping selections", () => {
    // TOOD: verify selection merging behavior
  })
})

describe("diff-selection", () => {
  test.todo("parses unified diff into structured changes", () => {
    // TOOD: feed sample diff, verify hunks extracted correctly
  })

  test.todo("handles empty diff input", () => {
    // TOOD: verify no errors on empty/null input
  })
})

describe("virtualizer", () => {
  test.todo("computes visible range from scroll position", () => {
    // TOOD: create virtualizer with known item heights, verify visible range
  })

  test.todo("updates on viewport resize", () => {
    // TOOD: change viewport height, verify visible range recalculated
  })
})

describe("selection-bridge", () => {
  test.todo("bridges worker/main thread selection state", () => {
    // TOOD: post selection change to worker, verify state sync
  })
})
