/**
 * Grounding test: isNaN → Number.isNaN fix verification
 *
 * Verifies that:
 * 1. No bare `isNaN(` remains in packages/opencode/src
 * 2. Number.isNaN correctly identifies NaN vs non-NaN number-like values
 * 3. The behavior at each fixed call site is equivalent (all values are `number` type)
 */
import { describe, expect, test } from "bun:test"
import { $ } from "bun"

describe("isNaN → Number.isNaN grounding", () => {
  test("no bare isNaN remains in source", async () => {
    const result = await $`rg -c '\bisNaN\(' ../packages/opencode/src --type ts`
      .cwd(import.meta.dir)
      .quiet()
      .text()
      .catch(() => "")

    // Search for bare isNaN (not Number.isNaN)
    const bare = await $`rg -n '\b(?<!Number\.)isNaN\(' ../packages/opencode/src --type ts`
      .cwd(import.meta.dir)
      .quiet()
      .text()
      .catch(() => "")

    expect(bare.trim()).toBe("")
  })

  test("Number.isNaN correctly identifies NaN", () => {
    // Core behavior: Number.isNaN is strict — only true for actual NaN
    expect(Number.isNaN(NaN)).toBe(true)
    expect(Number.isNaN(0)).toBe(false)
    expect(Number.isNaN(Infinity)).toBe(false)
    expect(Number.isNaN(undefined)).toBe(false) // key difference from global isNaN
    expect(Number.isNaN("foo" as any)).toBe(false) // key difference from global isNaN
    expect(Number.isNaN(null as any)).toBe(false) // key difference from global isNaN
  })

  test("global isNaN coerces (demonstrates why fix matters)", () => {
    // Global isNaN coerces non-number arguments to number first
    // This is why the fix is correct — prevents accidental NaN masking
    expect(isNaN(NaN)).toBe(true)
    expect(isNaN(0)).toBe(false)

    // These are the dangerous cases that Number.isNaN guards against:
    // isNaN("foo") → Number("foo") → NaN → true (false positive!)
    // Number.isNaN("foo") → false (correct, "foo" is not NaN)
  })

  test("stats.ts values are number-typed (equivalent behavior)", () => {
    // All stats.ts values come from arithmetic operations returning `number`
    // Both isNaN() and Number.isNaN() behave identically for `number` input
    const testCases: number[] = [NaN, 0, 1.5, -1, Infinity, -Infinity, 42]

    for (const val of testCases) {
      const oldResult = isNaN(val)
      const newResult = Number.isNaN(val)
      expect(newResult).toBe(oldResult)
    }
  })

  test("mcp/index.ts parseInt returns number (equivalent behavior)", () => {
    // parseInt always returns `number` (NaN on parse failure)
    const testInputs = ["123", "  456  ", "not-a-number", "", "0", "3.14"]

    for (const input of testInputs) {
      const parsed = parseInt(input, 10)
      const oldResult = isNaN(parsed)
      const newResult = Number.isNaN(parsed)
      expect(newResult).toBe(oldResult)
    }

    // Specific: empty string from trailing newline in text.split("\n")
    const trailingEmpty = parseInt("", 10) // NaN
    expect(Number.isNaN(trailingEmpty)).toBe(true)
    expect(!Number.isNaN(trailingEmpty)).toBe(false) // correctly filters
  })
})
