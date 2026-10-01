import { describe, expect, test } from "bun:test"
import { replace } from "../../src/tool/edit"

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
