import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Parameters, replace, replaceRange, replaceWithStage, resolveEdits } from "../../src/tool/edit"
import { chainHash, hashLabel } from "../../src/tool/read"

/**
 * THREE BLOCKS BELOW PIN A LAYER THE RUNTIME NO LONGER RUNS — LABELLED, NOT HIDDEN.
 *
 * `replace`, `replaceRange`, `replaceWithStage` and the ten `Replacer` stages are still EXPORTED from
 * `src/tool/edit.ts` and still behave exactly as the cases below assert — but nothing in `src/` calls them.
 * Measured 2026-10-01 (grep over `packages/opencode/src`): `replaceRange` and `replaceWithStage` appear ONLY
 * at their own definitions plus this file; `replaceWithStage` is called only by `replace`; and
 * `[^.\w]replace\(` returns the definition at `edit.ts:1212` plus two unrelated dialog `replace()` methods
 * (`dialog.tsx:122`, `api.tsx:300`) — **no caller in `src/`**. The live path is `resolveEdits` + `Parameters`
 * + `EditTool`, and it is covered by the two blocks at the bottom of this file.
 *
 * So those three blocks are GREEN AND CANNOT FAIL ON THE PRODUCT: they cannot go red when the tool's behaviour
 * changes, which is the entire job of a guard. They are kept until the dead layer is removed WITH them, in ONE
 * change, so the proof does not vanish before the thing it proves — the removal is box **H8** of
 * `plans/2026-10-01_hash-addressed-edits.md`, whose own intention already claims «and no fuzzy stage exists».
 *
 * WHAT MOVED, AND WHEN: the batch surface (H6, 2026-10-01) made `edit` take `files: [{ filePath, edits? }]`, so
 * the schema cases below were RE-PINNED to the shape a caller actually sends — the same three sides, none
 * dropped. Their red on the pre-H6 shape is recorded as provenance, not deleted as embarrassment:
 * `20261001T052355Z_7c3c83cb` — all three failed with `Missing key at ["files"]`.
 */
const FILE = "L1 alpha\nL2 beta\nL3 gamma\nL4 delta\nL5 epsilon\nL6 zeta\nL7 eta\nL8 theta\n"
/** First and last lines match, three of the six middle lines differ — probe C's shape. */
const DRIFTED = "L1 alpha\nL2 CHANGED-beta\nL3 gamma\nL4 CHANGED-delta\nL5 epsilon\nL6 CHANGED-zeta\nL7 eta\nL8 theta"

// SUPERSEDED (H8): pins the dead cascade — it cannot fail on the product; removed WITH the layer, not before it.
describe("tool.edit — replace() and the caller's declared precision", () => {
  test("DEFAULT: a padded anchor still applies — the accommodation is not removed", () => {
    expect(replace(FILE, "  L2 beta  ", "L2 PATCHED")).toContain("L2 PATCHED")
  })

  test("DEFAULT: content drift in the middle still applies — measured at the documented threshold", () => {
    expect(replace(FILE, DRIFTED, "REPLACED")).toContain("REPLACED")
  })

  test("EXACT: true refuses a padded anchor — the same call with the guess switched off", () => {
    expect(() => replace(FILE, "  L2 beta  ", "L2 PATCHED", false, true)).toThrow(/exact/i)
  })

  test("EXACT: true refuses content drift", () => {
    expect(() => replace(FILE, DRIFTED, "REPLACED", false, true)).toThrow(/exact/i)
  })

  test("EXACT: true still applies a literal anchor — it narrows, it does not disable", () => {
    expect(replace(FILE, "L2 beta", "L2 PATCHED", false, true)).toBe(
      "L1 alpha\nL2 PATCHED\nL3 gamma\nL4 delta\nL5 epsilon\nL6 zeta\nL7 eta\nL8 theta\n",
    )
  })

  test("EXACT: true turns a miss into a refusal, never a silent no-op", () => {
    expect(() => replace(FILE, "L9 nothing", "x", false, true)).toThrow(/exact/i)
  })
})

/**
 * THE ADDRESS, WITH ITS GUARD (plan F4). `read` prints absolute 1-based line numbers, so a caller can
 * say WHICH lines it means instead of describing them — but the numbers DRIFT, so the address carries
 * `expect`: the slice's text as the caller just read it.
 */
const TWICE = "head\nSAME\nSAME\nSAME\ntail\n"

// SUPERSEDED (H8): `from`/`to`/`expect` left the tool when the hash address replaced the line range.
describe("tool.edit — an address plus a guard", () => {
  test("replaces the NAMED lines even when the same text appears elsewhere", () => {
    // Three identical lines and the edit must reach the second: a content anchor cannot do this — it
    // refuses on multiple matches — while an address can, which is the whole point of having one.
    expect(replaceRange(TWICE, { from: 3, to: 3, expect: "SAME", replacement: "SECOND" })).toBe(
      "head\nSAME\nSECOND\nSAME\ntail\n",
    )
  })

  test("refuses WITHOUT `expect` — a bare address is exactly what the guard exists against", () => {
    expect(() => replaceRange(TWICE, { from: 3, to: 3, replacement: "x" })).toThrow(/expect/)
  })

  test("refuses when the lines moved, and shows BOTH sides so the caller can re-read", () => {
    expect(() => replaceRange(TWICE, { from: 2, to: 2, expect: "GONE", replacement: "x" })).toThrow(/no longer what/)
    expect(() => replaceRange(TWICE, { from: 2, to: 2, expect: "GONE", replacement: "x" })).toThrow(/"/)
  })

  test("a multi-line slice, and ONE trailing newline is the only difference allowed", () => {
    expect(replaceRange(TWICE, { from: 2, to: 3, expect: "SAME\nSAME\n", replacement: "X" })).toBe(
      "head\nX\nSAME\ntail\n",
    )
  })

  test("out of bounds and a reversed range are refusals, never silent clamps", () => {
    expect(() => replaceRange(TWICE, { from: 9, to: 9, expect: "x", replacement: "y" })).toThrow(/out of bounds/)
    expect(() => replaceRange(TWICE, { from: 4, to: 2, expect: "x", replacement: "y" })).toThrow(/out of bounds/)
  })
})

/**
 * THE ADDRESS MUST PASS THE TOOL'S OWN SCHEMA (plan F6) — AND, SINCE H6, IT RIDES IN A BATCH ENTRY.
 *
 * F4 was proven through `replaceRange` — one layer BELOW the call a caller actually makes — so the address
 * LOGIC was green while `Parameters` still demanded `oldString`, the very parameter the address branch throws
 * away. Every F4 case called the helper; none decoded the schema the runtime decodes (`tool/tool.ts:115`
 * compiles `Schema.decodeUnknownEffect(toolInfo.parameters)` per tool), and the defect survived until a LIVE
 * probe hit it on a real binary: `SchemaError(Missing key at ["oldString"])` for a call carrying
 * `from`/`to`/`expect`.
 *
 * H6 then moved the surface: the address rides on an ENTRY (`files[]`), not at the top level. These cases were
 * re-pinned to that shape — the same THREE sides, none dropped: an entry carrying addresses decodes; `content`
 * alone decodes; and NEITHER decodes HERE, because the schema does not decide it — the tool's own guard does,
 * with a message a caller can act on.
 */
describe("tool.edit — the TOOL's schema carries the batch, and the address rides in an entry", () => {
  const decode = Schema.decodeUnknownSync(Parameters)

  test("an entry carrying a list of addresses decodes — the shape `read` feeds", () => {
    expect(() =>
      decode({ files: [{ filePath: "x.txt", edits: [{ fromHash: "00000000", newString: "NEW" }] }] }),
    ).not.toThrow()
    expect(() =>
      decode({
        files: [{ filePath: "x.txt", edits: [{ fromHash: "a3f19c2e", toHash: "b7c1d0e4", newString: "NEW" }] }],
      }),
    ).not.toThrow()
  })

  test("`content` alone decodes — creating a file has no lines to address", () => {
    expect(() => decode({ files: [{ filePath: "x.txt", content: "hello\n" }] })).not.toThrow()
  })

  test("the schema does NOT decide `neither` — the tool's own guard does, naming both doors", () => {
    // Deliberate, exactly as under F6: a SchemaError cannot say «pass `edits` — or `content` to create a file»,
    // and that message is the one a caller can act on.
    expect(() => decode({ files: [{ filePath: "x.txt" }] })).not.toThrow()
  })
})

/**
 * THE EDIT LIST, RESOLVED THEN APPLIED (plan 2026-10-01_hash-addressed-edits, H3/H4).
 *
 * The addresses here are built the SAME way `read` prints them — the chain over the file — so the test states
 * the contract a caller actually meets rather than a private spelling of it. Two hashes name a span; anything
 * that does not resolve is a REFUSAL, and nothing lands near its address.
 */
describe("tool.edit — a list of addresses, resolved then applied", () => {
  const labels = (content: string) => {
    const out = [hashLabel(0)]
    let running = 0
    for (const line of content.split("\n")) out.push(hashLabel((running = chainHash(running, line))))
    return out
  }

  test("replaces a span by its two hashes and leaves the rest byte-identical", () => {
    const content = "alpha\nbeta\ngamma\ndelta\n"
    const h = labels(content)
    // `fromHash` names the line BEFORE the span, `toHash` its LAST line: lines 2..3 here.
    expect(resolveEdits(content, [{ fromHash: h[1]!, toHash: h[3]!, newString: "X" }])).toBe("alpha\nX\ndelta\n")
  })

  test("`toHash` absent means ONE line, and the seed `00000000` addresses the first", () => {
    const content = "alpha\nbeta\n"
    const h = labels(content)
    expect(h[0]).toBe("00000000")
    expect(resolveEdits(content, [{ fromHash: h[0]!, newString: "FIRST" }])).toBe("FIRST\nbeta\n")
    expect(resolveEdits(content, [{ fromHash: h[1]!, newString: "SECOND" }])).toBe("alpha\nSECOND\n")
  })

  test("the whole point: identical lines are addressable INDIVIDUALLY", () => {
    const content = "same\nsame\nsame\n"
    const h = labels(content)
    // `fromHash` is the label of the line BEFORE the span, so naming line 2 means passing LINE 1's label. My
    // first version of this expectation passed `h[2]` — line 2's OWN label — and the code correctly moved line
    // 3, because that is what «the line after this one» means. The test was wrong, not the contract.
    expect(resolveEdits(content, [{ fromHash: h[1]!, newString: "MIDDLE" }])).toBe("same\nMIDDLE\nsame\n")
    // Both halves of the owner's «хеш старта хеш конца»: the pair names the same single line explicitly.
    expect(resolveEdits(content, [{ fromHash: h[1]!, toHash: h[2]!, newString: "MIDDLE" }])).toBe(
      "same\nMIDDLE\nsame\n",
    )
    // …while the two neighbours — IDENTICAL to it — stay untouched, which a content anchor could never do.
  })

  test("a hash that is not in the file is a REFUSAL — never a nearby landing", () => {
    expect(() => resolveEdits("alpha\nbeta\n", [{ fromHash: "deadbeef", newString: "X" }])).toThrow(/not in this file/)
  })

  test("a malformed hash is refused, and the refusal names the entry", () => {
    expect(() => resolveEdits("alpha\n", [{ fromHash: "DEADBEEF", newString: "X" }])).toThrow(/edit 1/)
  })

  test("two entries claiming one line are refused, not ordered by luck", () => {
    const content = "alpha\nbeta\n"
    const h = labels(content)
    expect(() =>
      resolveEdits(content, [
        { fromHash: h[0]!, newString: "A" },
        { fromHash: h[0]!, newString: "B" },
      ]),
    ).toThrow(/claim line/)
  })

  test("ALL entries resolve BEFORE any is applied — a later span is not moved by an earlier edit", () => {
    const content = "one\ntwo\nthree\n"
    const h = labels(content)
    // Entry 1 rewrites line 2 with TWO lines; entry 2 still addresses line 3 by ITS ORIGINAL hash. Applied
    // top-down, entry 2 would land one line late — which is exactly the failure this order removes.
    expect(
      resolveEdits(content, [
        { fromHash: h[1]!, newString: "SECOND-A\nSECOND-B" },
        { fromHash: h[2]!, newString: "THIRD" },
      ]),
    ).toBe("one\nSECOND-A\nSECOND-B\nTHIRD\n")
  })
})

/**
 * THE SPAN'S EDGES (plan H9c). Owner, 2026-10-01: «от хеша - до хеша вставляем что отправил агент», with the
 * agent's endings fitted to the file's, and the final terminator «проверить как было в оригинале и не
 * выдумывать». Every case below was measured WRONG before this change (experiments/2026-10-01_chain-review):
 * `""` left a blank line, a trailing `\n` added one, and an append either was refused or ate the final newline.
 */
describe("tool.edit — the span's edges: deletion, the final terminator, insertion, endings", () => {
  const labels = (content: string) => {
    const out = [hashLabel(0)]
    let running = 0
    for (const line of content.split("\n")) out.push(hashLabel((running = chainHash(running, line.replace(/\r$/, "")))))
    return out
  }

  test("an empty `newString` DELETES the span — no blank line is left behind", () => {
    const content = "a\nb\nc\n"
    const h = labels(content)
    expect(resolveEdits(content, [{ fromHash: h[1]!, newString: "" }])).toBe("a\nc\n")
    expect(resolveEdits(content, [{ fromHash: h[0]!, toHash: h[3]!, newString: "" }])).toBe("")
    // Deleting an UNTERMINATED last line keeps the file's final form: it still ends without a terminator.
    const bare = "a\nb"
    expect(resolveEdits(bare, [{ fromHash: labels(bare)[1]!, newString: "" }])).toBe("a")
  })

  test("ONE trailing terminator is the last line's own: «B» and «B\\n» are the same line, «\\n» is a blank one", () => {
    const content = "a\nb\nc\n"
    const h = labels(content)
    expect(resolveEdits(content, [{ fromHash: h[1]!, newString: "B\n" }])).toBe("a\nB\nc\n")
    expect(resolveEdits(content, [{ fromHash: h[1]!, newString: "B" }])).toBe("a\nB\nc\n")
    expect(resolveEdits(content, [{ fromHash: h[1]!, newString: "\n" }])).toBe("a\n\nc\n")
  })

  test("the ORIGINAL decides the final terminator — an unterminated last line stays unterminated", () => {
    const content = "a\nb"
    const h = labels(content)
    expect(resolveEdits(content, [{ fromHash: h[1]!, newString: "B\n" }])).toBe("a\nB")
  })

  test("`toHash` equal to `fromHash` is the EMPTY span after that line: an insertion", () => {
    const content = "a\nc\n"
    const h = labels(content)
    expect(resolveEdits(content, [{ fromHash: h[1]!, toHash: h[1]!, newString: "b" }])).toBe("a\nb\nc\n")
    expect(resolveEdits(content, [{ fromHash: h[0]!, toHash: h[0]!, newString: "first" }])).toBe("first\na\nc\n")
  })

  test("appending after the LAST line keeps the file's own final form, terminated or not", () => {
    const terminated = "a\nb\n"
    const t = labels(terminated)
    expect(resolveEdits(terminated, [{ fromHash: t[2]!, toHash: t[2]!, newString: "c" }])).toBe("a\nb\nc\n")
    const bare = "a\nb"
    const b = labels(bare)
    expect(resolveEdits(bare, [{ fromHash: b[2]!, toHash: b[2]!, newString: "c" }])).toBe("a\nb\nc")
    // A ONE-line file without any break has no ending to copy — and the append must still not GLUE the lines.
    const single = "a"
    const s = labels(single)
    expect(resolveEdits(single, [{ fromHash: s[1]!, toHash: s[1]!, newString: "c" }])).toBe("a\nc")
  })

  test("the address cannot reach past the last line: no phantom line after the final terminator", () => {
    const content = "a\nb\n"
    const h = labels(content)
    expect(() => resolveEdits(content, [{ fromHash: h[2]!, newString: "c" }])).toThrow(/past the end/)
  })

  test("an empty file takes an insertion at the seed, written as sent — there is no original to copy", () => {
    expect(resolveEdits("", [{ fromHash: "00000000", toHash: "00000000", newString: "x\n" }])).toBe("x\n")
  })

  test("the agent's endings are fitted to the file's MAJORITY ending; the last line keeps the original's", () => {
    const crlf = "a\r\nb\r\n"
    const c = labels(crlf)
    expect(resolveEdits(crlf, [{ fromHash: c[0]!, newString: "X\nY" }])).toBe("X\r\nY\r\nb\r\n")
    // Mostly LF with one CRLF line: the new internal break is LF, and the replaced line's own CRLF survives.
    const mixed = "a\r\nb\nc\nd\n"
    const m = labels(mixed)
    expect(resolveEdits(mixed, [{ fromHash: m[0]!, newString: "X\r\nY" }])).toBe("X\nY\r\nb\nc\nd\n")
  })

  test("two insertions at one point, or an insertion where a span starts, are refused — no defined order", () => {
    const content = "a\nb\n"
    const h = labels(content)
    expect(() =>
      resolveEdits(content, [
        { fromHash: h[1]!, toHash: h[1]!, newString: "x" },
        { fromHash: h[1]!, toHash: h[1]!, newString: "y" },
      ]),
    ).toThrow(/claim line/)
    expect(() =>
      resolveEdits(content, [
        { fromHash: h[1]!, toHash: h[1]!, newString: "x" },
        { fromHash: h[1]!, newString: "B" },
      ]),
    ).toThrow(/claim line/)
  })

  test("a `toHash` ABOVE `fromHash` is still an inverted range", () => {
    const content = "a\nb\nc\n"
    const h = labels(content)
    expect(() => resolveEdits(content, [{ fromHash: h[2]!, toHash: h[1]!, newString: "x" }])).toThrow(/inverted/)
  })
})

/**
 * THE STAGE IS NAMED (plan F3).
 *
 * Probe C measured that a drifted anchor APPLIES while the success said nothing about it — so how much
 * drift got forgiven was decided by the tool and reported nowhere. The stage names asserted here are the
 * matcher's OWN, read from the same table that holds the functions, so a stage cannot be added there and
 * forgotten in a list of labels.
 */
// SUPERSEDED (H8): the stage name is real for the dead cascade and unreachable from the tool.
describe("tool.edit — the stage that matched is reported", () => {
  test("a literal anchor matches at the exact stage", () => {
    expect(replaceWithStage(FILE, "L2 beta", "L2 PATCHED").stage).toBe("exact")
  })

  test("a padded anchor matches at line-trimmed — the shape probe B measured", () => {
    expect(replaceWithStage(FILE, "  L2 beta  ", "L2 PATCHED").stage).toBe("line-trimmed")
  })

  test("drift in the middle matches at block-anchor — the shape probe C measured", () => {
    expect(replaceWithStage(FILE, DRIFTED, "REPLACED").stage).toBe("block-anchor")
  })

  test("`replace` still returns bare content, so no existing caller is disturbed", () => {
    expect(replace(FILE, "L2 beta", "L2 PATCHED")).toBe(replaceWithStage(FILE, "L2 beta", "L2 PATCHED").content)
    expect(typeof replace(FILE, "L2 beta", "L2 PATCHED")).toBe("string")
  })

  test("`exact: true` reports the exact stage or throws — it never reports a guess", () => {
    expect(replaceWithStage(FILE, "L2 beta", "L2 PATCHED", false, true).stage).toBe("exact")
    expect(() => replaceWithStage(FILE, "  L2 beta  ", "x", false, true)).toThrow(/exact/i)
  })
})
