import { describe, expect, test } from "bun:test"
import { replace, replaceRange, replaceWithStage } from "../../src/tool/edit"

/**
 * `exact` — the CALLER states the precision of its anchor.
 *
 * MEASURED 2026-10-01 against the live binary (`experiments/2026-10-01_edit-probes/README.md`):
 *   A  anchor absent                      -> refused, file unchanged
 *   B  anchor padded with spaces          -> APPLIED (the accommodation that keeps a drifting anchor alive)
 *   C  first+last lines match, 3 of 6 middle lines DIFFER -> APPLIED, whole block replaced
 * — probe C sitting exactly on the loosest stage's documented 50 % middle threshold, with the SUCCESS
 * report never saying which stage fired.
 *
 * The cascade is deliberate and is NOT removed: a model's anchor drifts in whitespace and indentation,
 * and refusing all of it would burn turns re-reading. What changes is WHO decides how much drift is
 * forgiven. Today the tool decides, silently. With `exact: true` the caller does.
 */
const FILE = "L1 alpha\nL2 beta\nL3 gamma\nL4 delta\nL5 epsilon\nL6 zeta\nL7 eta\nL8 theta\n"
/** First and last lines match, three of the six middle lines differ — probe C's shape. */
const DRIFTED = "L1 alpha\nL2 CHANGED-beta\nL3 gamma\nL4 CHANGED-delta\nL5 epsilon\nL6 CHANGED-zeta\nL7 eta\nL8 theta"

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
 * THE STAGE IS NAMED (plan F3).
 *
 * Probe C measured that a drifted anchor APPLIES while the success said nothing about it — so how much
 * drift got forgiven was decided by the tool and reported nowhere. The stage names asserted here are the
 * matcher's OWN, read from the same table that holds the functions, so a stage cannot be added there and
 * forgotten in a list of labels.
 */
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
