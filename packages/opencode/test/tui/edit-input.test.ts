/**
 * `Edit` renderer's input summary — pinned against MALFORMED raw model input.
 *
 * Crash report 2026-10-08 (opencode 10.0.1222, "opentui: fatal"): a tool part
 * whose `input.files` was not an array took the whole TUI down, because the
 * renderer mapped over it directly — `(H.input.files ?? []).map is not a
 * function`. `state.input` is the model's raw call (the processor writes it
 * into the part before any schema decode), so the renderer must DEGRADE on a
 * malformed call, never throw — a throw here is a fatal TUI error, not a tool
 * failure.
 */
import { describe, expect, test } from "bun:test"
import { editInputSummary } from "../../src/cli/cmd/tui/routes/session/edit-input"

describe("editInputSummary", () => {
  test("names come from the completed part's filediffs when metadata is present", () => {
    const summary = editInputSummary({ files: [{ filePath: "c.ts", edits: [{}] }] }, [{ file: "a.ts" }, { file: "b.ts" }])
    expect(summary.names).toEqual(["a.ts", "b.ts"])
    expect(summary.changes).toBe(1)
  })

  test("names fall back to the raw filePaths; changes sum the edit lists with ?? 1", () => {
    const summary = editInputSummary({ files: [{ filePath: "c.ts", edits: [{}, {}] }, { filePath: "d.ts" }] }, [])
    expect(summary.names).toEqual(["c.ts", "d.ts"])
    expect(summary.changes).toBe(3)
  })

  test("a malformed `files` (object) degrades to an empty summary instead of throwing", () => {
    const summary = editInputSummary({ files: { filePath: "x.ts" } }, [])
    expect(summary.names).toEqual([])
    expect(summary.changes).toBe(0)
  })

  test("a `files` that is not array-like at all degrades the same way", () => {
    expect(editInputSummary({ files: "x.ts" }, []).names).toEqual([])
    expect(editInputSummary({ files: 7 }, []).changes).toBe(0)
  })

  test("null entries inside `files` do not throw", () => {
    const summary = editInputSummary({ files: [null, { filePath: "a.ts" }] }, [])
    expect(summary.names).toEqual(["", "a.ts"])
    expect(summary.changes).toBe(2)
  })

  test("an absent `files` yields an empty summary", () => {
    expect(editInputSummary({}, [])).toEqual({ names: [], changes: 0 })
  })
})
