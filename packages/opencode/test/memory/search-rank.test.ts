/**
 * The relevance half of the hybrid rank must not be zeroed (measured 2026-09-22).
 *
 * WHY this pin reads the source instead of querying: the rank lives in one SQL string inside
 * `searchParts`, and the defect it guards against is an EXPRESSION, not a behaviour a fixture can
 * reach without standing up a whole memory index. What a fixture could not have caught is exactly what
 * happened: `bm25(part_fts, 0.0, 0.0)` weights the indexed column by zero, so every row scores 0 and
 * the hybrid rank collapses to the epistemic term alone — every hit printed `BM25: 0` and identical
 * ranks, and the huge Exact-heavy m* rows topped every query. The live measurement that found it, on
 * the same rows: -8.296 / -10.796 / -12.107 with a real weight versus 0.000 / 0.000 / 0.000 with the
 * zeroed one.
 *
 * A source pin is weaker than a behavioural one and is worth it only when the alternative is no pin at
 * all: this asserts the two properties that make the rank real — a NON-ZERO column weight, and the
 * negation that keeps `ORDER BY combined_rank DESC` meaning "best first" (bm25() returns a negative
 * number with smaller = more relevant).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

describe("messagesearch's hybrid rank", () => {
  const source = readFileSync(path.join(import.meta.dir, "../../src/memory/memory.ts"), "utf8")
  // The comment above the expression QUOTES the broken form on purpose, so the check reads CODE:
  // SQL comments are stripped first. A probe that cannot tell prose from code fails on its own
  // explanation — which is exactly what this pin did on its first run.
  const code = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")

  test("the BM25 term carries a real weight, not zero", () => {
    expect(code).toContain("-bm25(part_fts, 1.0, 0.0)")
    expect(code).not.toContain("bm25(part_fts, 0.0, 0.0)")
  })

  test("the relevance term is negated, because bm25() is negative and smaller means better", () => {
    const at = code.indexOf("AS combined_rank")
    expect(at).toBeGreaterThan(-1)
    const expression = code.slice(Math.max(0, at - 400), at)
    expect(expression).toContain("-bm25(")
  })
})
