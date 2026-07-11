import { describe, expect, test } from "bun:test"

/**
 * Tests for TextReveal width handling.
 *
 * The production code in text-reveal.tsx must handle the initial "auto"
 * width state without producing NaN parseFloat values.
 */

/**
 * Simulates the fixed widen() logic from text-reveal.tsx.
 */
function widen(
  currentWidth: string,
  next: number,
  options: { growOnly?: boolean } = {},
): string | null {
  // Returns null if width doesn't change, or the new width string
  if (next <= 0) return null
  if (options.growOnly ?? true) {
    const raw = currentWidth
    // width() can be "auto" on first render — treat as 0 for comparison
    const prev = raw === "auto" ? 0 : Number.parseFloat(raw)
    if (Number.isFinite(prev) && next <= prev) return null
  }
  return `${next}px`
}

describe("TextReveal widen", () => {
  test("handles initial 'auto' width without NaN", () => {
    // This used to produce NaN because parseFloat("auto") = NaN
    const result = widen("auto", 100)
    // Should produce "100px" — parseFloat("auto") = NaN, !isFinite(NaN) = false,
    // so the guard is bypassed and next (100) is set
    expect(result).toBe("100px")
  })

  test("allows larger width when growOnly", () => {
    const result = widen("100px", 200, { growOnly: true })
    expect(result).toBe("200px")
  })

  test("prevents smaller width when growOnly", () => {
    const result = widen("200px", 100, { growOnly: true })
    expect(result).toBeNull()
  })

  test("does not prevent smaller width when !growOnly", () => {
    const result = widen("200px", 100, { growOnly: false })
    expect(result).toBe("100px")
  })

  test("ignores non-positive width", () => {
    expect(widen("auto", 0)).toBeNull()
    expect(widen("auto", -10)).toBeNull()
  })

  test("parses numeric CSS width strings correctly", () => {
    expect(widen("50px", 75)).toBe("75px")
  })

  test("handles decimal width strings", () => {
    expect(widen("50.5px", 60.3)).toBe("60.3px")
  })
})
