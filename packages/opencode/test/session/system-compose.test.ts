import { describe, expect, test } from "bun:test"
import { composeCheckpointSystemPrompt } from "../../src/session/system-compose"

/**
 * Single-identity discipline for persisted checkpoint systemPrompt.
 *
 * Regression: captureSummary prepended the identity (= reasoning kernel,
 * ~57k chars) on EVERY call over a live checkpoint — three compactions grew
 * the wire prefix to three kernel copies (~35-40k dead tokens per request).
 * The composer must repair accumulated copies on reuse and prepend exactly
 * once on fresh assembly.
 */

const IDENTITY = "KERNEL-IDENTITY-TEXT"
const RULES = ["rule-a", "rule-b"]

describe("composeCheckpointSystemPrompt — single-identity invariant", () => {
  test("fresh assembly prepends identity exactly once", () => {
    const result = composeCheckpointSystemPrompt({ stored: undefined, freshPath: RULES, identity: IDENTITY })
    expect(result).toEqual([IDENTITY, ...RULES])
    expect(result.filter((entry) => entry === IDENTITY)).toHaveLength(1)
  })

  test("reuse of a clean stored prompt is unchanged", () => {
    const stored = [IDENTITY, ...RULES]
    const result = composeCheckpointSystemPrompt({ stored, freshPath: [], identity: IDENTITY })
    expect(result).toEqual([IDENTITY, ...RULES])
    expect(result.filter((entry) => entry === IDENTITY)).toHaveLength(1)
  })

  test("reuse repairs historical identity accumulation (3 compactions)", () => {
    // What the old captureSummary produced: identity copied on every capture.
    const stored = [IDENTITY, IDENTITY, IDENTITY, ...RULES]
    const result = composeCheckpointSystemPrompt({ stored, freshPath: [], identity: IDENTITY })
    expect(result).toEqual([IDENTITY, ...RULES])
    expect(result.filter((entry) => entry === IDENTITY)).toHaveLength(1)
    // Rules survive the repair untouched.
    expect(result.slice(1)).toEqual(RULES)
  })

  test("repair keeps non-identity duplicates (only identity discipline is enforced)", () => {
    const stored = [IDENTITY, "rule-a", "rule-a", IDENTITY]
    const result = composeCheckpointSystemPrompt({ stored, freshPath: [], identity: IDENTITY })
    expect(result).toEqual([IDENTITY, "rule-a", "rule-a"])
  })

  test("empty identity on fresh assembly prepends nothing", () => {
    const result = composeCheckpointSystemPrompt({ stored: undefined, freshPath: RULES, identity: "" })
    expect(result).toEqual(RULES)
  })

  test("empty stored array falls back to fresh assembly", () => {
    const result = composeCheckpointSystemPrompt({ stored: [], freshPath: RULES, identity: IDENTITY })
    expect(result).toEqual([IDENTITY, ...RULES])
  })
})
