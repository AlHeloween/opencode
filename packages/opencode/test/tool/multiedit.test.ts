import { describe, expect, test } from "bun:test"
import { multiEditRetired } from "../../src/tool/multiedit"

/**
 * `multiedit` IS RETIRED (plan 2026-10-01_hash-addressed-edits, H3/H5) — and this file is REPLACED, not
 * adjusted: every case it used to carry tested a tool that no longer exists as a tool.
 *
 * Its real property did not die with it. «Resolve everything against a buffer first, write once, and say that
 * nothing was written when something fails» became `edit`'s own, made structural by `resolveEdits` — and it is
 * asserted there, in `edit-exact.test.ts`, against the contract a caller actually crosses:
 *   - «ALL entries resolve BEFORE any is applied — a later span is not moved by an earlier edit»
 *   - «two entries claiming one line are refused, not ordered by luck»
 *   - «a hash that is not in the file is a REFUSAL — never a nearby landing»
 *
 * What is left to assert HERE is the one thing only this module can state: that it is closed.
 */
describe("tool.multiedit — retired", () => {
  test("says so, and points at the tool that replaced it", () => {
    expect(multiEditRetired()).toMatch(/RETIRED/)
    expect(multiEditRetired()).toMatch(/fromHash/)
  })
})
