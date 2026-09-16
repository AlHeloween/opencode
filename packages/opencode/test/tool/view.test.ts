import { expect, test } from "bun:test"
import { applyView, describe as describeView, isActive, parseRange } from "../../src/tool/view"

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")

test("no view returns the text untouched", () => {
  const result = applyView("a\nb\nc", {})
  expect(result.text).toBe("a\nb\nc")
  expect(result.total).toBe(3)
  expect(result.matched).toBe(3)
  expect(result.shown).toBe(3)
  expect(isActive({})).toBe(false)
})

test("head and tail take the ends", () => {
  expect(applyView(lines(100), { head: 3 }).text).toBe("line 1\nline 2\nline 3")
  expect(applyView(lines(100), { tail: 2 }).text).toBe("line 99\nline 100")
})

test("head then tail takes a window, not an empty set", () => {
  // Both together is a legitimate ask — "lines 8..10" expressed as ends.
  // Applying tail to the ORIGINAL rather than to head's result would return
  // the last two lines of the file instead.
  expect(applyView(lines(100), { head: 10, tail: 3 }).text).toBe("line 8\nline 9\nline 10")
})

test("a range is 1-based and inclusive at both ends", () => {
  expect(applyView(lines(100), { lines: "5-7" }).text).toBe("line 5\nline 6\nline 7")
  expect(applyView(lines(100), { lines: "99-" }).text).toBe("line 99\nline 100")
  expect(applyView(lines(5), { lines: "-3" }).text).toBe("line 1\nline 2\nline 3")
  expect(applyView(lines(100), { lines: "42" }).text).toBe("line 42")
})

test("an open range end is the edge of the text, never zero", () => {
  // "-180" means "up to 180". Reading the empty side as 0 would return nothing
  // and look like the text simply had no such lines.
  expect(parseRange("-180")).toEqual({ from: 1, to: 180 })
  expect(parseRange("120-").to).toBe(Number.MAX_SAFE_INTEGER)
  expect(parseRange("120-").from).toBe(120)
})

test("a range past the end returns what exists rather than padding", () => {
  expect(applyView(lines(3), { lines: "2-999" }).text).toBe("line 2\nline 3")
  expect(applyView(lines(3), { lines: "50-60" }).text).toBe("")
})

test("a malformed range says how to write one", () => {
  expect(() => parseRange("120..180")).toThrow(/Use "120-180"/)
  expect(() => parseRange("0-5")).toThrow(/1-based/)
  expect(() => parseRange("9-2")).toThrow(/end is before start/)
})

test("the pattern runs first, so head counts matches and not raw lines", () => {
  // "the first 2 errors" must not mean "however many errors are in the first 2
  // lines". This ordering is the whole reason the view exists as one function.
  const log = ["ok", "ERROR disk", "ok", "ERROR net", "ok", "ERROR dns"].join("\n")
  const result = applyView(log, { pattern: "^ERROR", head: 2 })
  expect(result.text).toBe("ERROR disk\nERROR net")
  expect(result.total).toBe(6)
  expect(result.matched).toBe(3)
  expect(result.shown).toBe(2)
})

test("case sensitivity is opt-in here too", () => {
  const log = "Error one\nerror two"
  expect(applyView(log, { pattern: "error" }).shown).toBe(1)
  expect(applyView(log, { pattern: "error", ignoreCase: true }).shown).toBe(2)
})

test("the summary line says what was dropped and where the rest is", () => {
  // A view that silently drops 900 of 1000 lines is how a partial answer gets
  // read as a complete one.
  const result = applyView(lines(1000), { pattern: "line 1$", head: 1 })
  const summary = describeView(result, "/data/tool_abc")
  expect(summary).toContain("1 of 1 matching line")
  expect(summary).toContain("1000 total")
  expect(summary).toContain("full output kept at /data/tool_abc")
})

test("isActive only reports fields that would change the output", () => {
  expect(isActive({ pattern: "" })).toBe(false)
  expect(isActive({ ignoreCase: true })).toBe(false)
  expect(isActive({ head: 0 })).toBe(true)
  expect(isActive({ lines: "1-2" })).toBe(true)
})
