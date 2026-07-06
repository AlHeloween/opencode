import { describe, expect, test } from "bun:test"
import { computeDiffWasm, createPatch, diffStats, initDiffy } from "../../src/util/diff-wasm"

describe("diff-wasm", () => {
  test("loads diffy wasm module", async () => {
    expect(await initDiffy()).toBeTrue()
  })

  test("creates unified patches with additions", async () => {
    const patch = await createPatch("a\nb", "a\nc\nb")
    expect(patch).not.toBeNull()
    expect(patch!).toContain("+c")
  })

  test("computes addition and deletion stats", async () => {
    expect(await diffStats("a\nb", "a\nc\nb")).toEqual({ additions: 1, deletions: 0 })
    expect(await diffStats("a\nc\nb", "a\nb")).toEqual({ additions: 0, deletions: 1 })
  })

  test("parses diff hunks from diffy output shape", async () => {
    const result = await computeDiffWasm("a\nb", "a\nc\nb")
    expect(result).not.toBeNull()
    expect(result!).toHaveLength(1)
    expect(result![0].old_start).toBe(1)
    expect(result![0].new_start).toBe(1)
    expect(result![0].lines.map((line) => line.kind)).toEqual(["context", "insert", "context"])
  })

  test("hunk header counts match body lines after recount", async () => {
    const patch = await createPatch("line1\nline2\nline3\n", "line1\nline2-modified\nline3\n")
    expect(patch).not.toBeNull()
    // Extract all @@ headers and verify each matches body counts
    const lines = patch!.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]!.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/)
      if (!m) continue
      const headerOld = parseInt(m[2]!, 10)
      const headerNew = parseInt(m[4]!, 10)
      let actualOld = 0
      let actualNew = 0
      for (let j = i + 1; j < lines.length; j++) {
        const bl = lines[j]!
        if (bl.startsWith("@@") || bl.startsWith("---") || bl.startsWith("+++")) break
        if (bl === "") continue
        const prefix = bl[0]!
        if (prefix === " " || prefix === "-") actualOld++
        if (prefix === " " || prefix === "+") actualNew++
      }
      expect(actualOld).toBe(headerOld)
      expect(actualNew).toBe(headerNew)
    }
  })

  test("hunk counts correct for files without trailing newline", async () => {
    // Files without trailing \n trigger \ No newline marker in WASM output
    const patch = await createPatch("line1\nline2", "line1\nline2-modified")
    expect(patch).not.toBeNull()
    const lines = patch!.split("\n")
    // Find the hunk header
    const hunkIdx = lines.findIndex((l) => l.startsWith("@@"))
    expect(hunkIdx).not.toBe(-1)
    const m = lines[hunkIdx]!.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/)
    expect(m).not.toBeNull()
    const headerOld = parseInt(m![2]!, 10)
    const headerNew = parseInt(m![4]!, 10)
    let actualOld = 0
    let actualNew = 0
    for (let j = hunkIdx + 1; j < lines.length; j++) {
      const bl = lines[j]!
      if (bl.startsWith("@@")) break
      if (bl === "") continue
      const prefix = bl[0]!
      if (prefix === " " || prefix === "-") actualOld++
      if (prefix === " " || prefix === "+") actualNew++
    }
    expect(actualOld).toBe(headerOld)
    expect(actualNew).toBe(headerNew)
  })
})
