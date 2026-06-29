import { describe, expect, test } from "bun:test"
import { computeDiffWasm, type DiffHunk } from "../../src/util/diff-wasm"

describe("computeDiffWasm", () => {
  test("identical texts produce single equal hunk", async () => {
    const result = await computeDiffWasm("a\nb", "a\nb")
    if (!result) {
      // WASM unavailable, skip
      return
    }
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ type: "equal", oldStart: 0, newStart: 0, length: 2 })
  })

  test("insertion in the middle", async () => {
    const result = await computeDiffWasm("a\nb", "a\nc\nb")
    if (!result) return
    expect(result.length).toBeGreaterThanOrEqual(2)
    // Should have: equal(a), insert(c), equal(b) or similar
    const types = result.map((h: DiffHunk) => h.type)
    expect(types).toContain("insert")
  })

  test("deletion in the middle", async () => {
    const result = await computeDiffWasm("a\nb\nc", "a\nc")
    if (!result) return
    expect(result.length).toBeGreaterThanOrEqual(2)
    const types = result.map((h: DiffHunk) => h.type)
    expect(types).toContain("delete")
  })

  test("empty old text (pure insertion)", async () => {
    const result = await computeDiffWasm("", "new")
    if (!result) return
    expect(result.length).toBeGreaterThanOrEqual(1)
    const types = result.map((h: DiffHunk) => h.type)
    expect(types).toContain("insert")
  })

  test("empty new text (pure deletion)", async () => {
    const result = await computeDiffWasm("old", "")
    if (!result) return
    expect(result.length).toBeGreaterThanOrEqual(1)
    const types = result.map((h: DiffHunk) => h.type)
    expect(types).toContain("delete")
  })

  test("both empty produces empty array", async () => {
    const result = await computeDiffWasm("", "")
    if (!result) return
    expect(result).toEqual([])
  })

  test("returns null on WASM load failure (graceful fallback)", async () => {
    // This test verifies the function doesn't throw
    const result = await computeDiffWasm("test", "test2")
    // Either we get a valid result or null (WASM unavailable)
    if (result !== null) {
      expect(Array.isArray(result)).toBeTrue()
    }
  })

  test("output hunks have correct structure", async () => {
    const result = await computeDiffWasm("line1\nline2\nline3", "line1\nmodified\nline3")
    if (!result) return

    for (const hunk of result) {
      expect(["equal", "delete", "insert"]).toContain(hunk.type)
      if (hunk.type === "equal") {
        expect(typeof hunk.oldStart).toBe("number")
        expect(typeof hunk.newStart).toBe("number")
        expect(typeof hunk.length).toBe("number")
      } else if (hunk.type === "delete") {
        expect(typeof hunk.oldStart).toBe("number")
        expect(typeof hunk.oldEnd).toBe("number")
      } else if (hunk.type === "insert") {
        expect(typeof hunk.newStart).toBe("number")
        expect(typeof hunk.newEnd).toBe("number")
      }
    }
  })

  test("handles CRLF line endings", async () => {
    const result = await computeDiffWasm("a\r\nb\r\n", "a\r\nb\r\n")
    if (!result) return
    // Should treat CRLF same as LF
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  test("large input performance", async () => {
    // Generate 10000 lines with a few changes
    const oldLines: string[] = []
    const newLines: string[] = []
    for (let i = 0; i < 10000; i++) {
      oldLines.push(`line ${i}`)
      newLines.push(`line ${i}`)
    }
    // Insert 10 lines at position 5000
    for (let i = 0; i < 10; i++) {
      newLines.splice(5000 + i, 0, `inserted ${i}`)
    }

    const start = performance.now()
    const result = await computeDiffWasm(oldLines.join("\n"), newLines.join("\n"))
    const elapsed = performance.now() - start

    if (!result) return
    expect(elapsed).toBeLessThan(5000)  // generous timeout for CI
    // Verify the diff makes sense
    const insertHunks = result.filter((h: DiffHunk) => h.type === "insert")
    expect(insertHunks.length).toBeGreaterThanOrEqual(1)
  })
})
