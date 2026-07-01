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
})
