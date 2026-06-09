/**
 * Phase 2 Tests: Prefix Divergence Detection
 *
 * Run: cd packages/opencode && bun test test/experiments/20260610_cache_guardrail/phase2_divergence.test.ts
 */

import { describe, expect, test } from "bun:test"
import {
  computeDivergence,
  tokenize,
  computeLCP,
  classifyDivergence,
  type Request,
  type DivergenceCause,
} from "./phase2_divergence"

// ── Helpers ────────────────────────────────────────────────────────────────

function req(system: string[], ...messages: Array<[string, string]>): Request {
  return {
    system,
    messages: messages.map(([role, content]) => ({
      role: role as "user" | "assistant",
      content,
    })),
  }
}

function reqEmpty(system: string[]): Request {
  return { system, messages: [] }
}

function expectDivergence(
  prev: Request,
  next: Request,
  expected: { cause: DivergenceCause; commonTokens: number; minHitRatio: number; maxHitRatio: number },
) {
  const report = computeDivergence(prev, next)
  expect(report.divergenceCause).toBe(expected.cause)
  expect(report.commonTokens).toBe(expected.commonTokens)
  expect(report.expectedHitRatio).toBeGreaterThanOrEqual(expected.minHitRatio)
  expect(report.expectedHitRatio).toBeLessThanOrEqual(expected.maxHitRatio)
}

// ── Tokenizer ──────────────────────────────────────────────────────────────

describe("tokenizer", () => {
  test("tokenizes request into tagged tokens", () => {
    const r: Request = {
      system: ["You are helpful", "Today's date: June 9, 2026"],
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
    }
    const tokens = tokenize(r)
    expect(tokens.length).toBeGreaterThan(8)

    // System tokens
    expect(tokens[0].source).toBe("system[0]")
    expect(tokens[0].text).toBe("You")

    // Find first user token
    const userTokens = tokens.filter((t) => t.source.startsWith("user"))
    expect(userTokens.length).toBe(1)
    expect(userTokens[0].text).toBe("Hello")
    expect(userTokens[0].source).toBe("user[0]")

    // Assistant tokens
    const assistantTokens = tokens.filter((t) => t.source.startsWith("assistant"))
    expect(assistantTokens.length).toBe(2) // "Hi" "there"
  })
})

// ── LCP ────────────────────────────────────────────────────────────────────

describe("LCP", () => {
  test("identical tokens → full match", () => {
    const tokens1 = tokenize(req(["A B C"], ["user", "hello world"]))
    const tokens2 = tokenize(req(["A B C"], ["user", "hello world"]))
    const { commonTokens, divergenceIndex } = computeLCP(tokens1, tokens2)
    expect(commonTokens).toBe(tokens1.length)
    expect(divergenceIndex).toBe(tokens1.length)
  })

  test("different first token → zero match", () => {
    const t1 = tokenize(req(["A"], ["user", "hello"]))
    const t2 = tokenize(req(["B"], ["user", "hello"]))
    const { commonTokens } = computeLCP(t1, t2)
    expect(commonTokens).toBe(0)
  })

  test("partially different → partial match", () => {
    const t1 = tokenize(req(["A B C"], ["user", "hello"]))
    const t2 = tokenize(req(["A B C"], ["user", "world"]))
    const { commonTokens } = computeLCP(t1, t2)
    // "A B C hello" matched (3 system + hello), "world" differs
    expect(commonTokens).toBe(3) // A, B, C
  })
})

// ── Divergence Classification ──────────────────────────────────────────────

describe("divergence classification", () => {
  test("T01: identical requests", () => {
    const r = req(
      ["system prompt", "rules and env", "Today's date: June 9, 2026"],
      ["user", "write code"],
      ["assistant", "here is code"],
    )
    expectDivergence(r, r, { cause: "identical", commonTokens: 15, minHitRatio: 0.99, maxHitRatio: 1.0 })
  })

  test("T02: new message appended", () => {
    const prev = req(
      ["system prompt", "rules", "Today's date: June 9, 2026"],
      ["user", "question one"],
    )
    const next = req(
      ["system prompt", "rules", "Today's date: June 9, 2026"],
      ["user", "question one"],
      ["assistant", "answer one"],
    )
    expectDivergence(prev, next, {
      cause: "new_message_appended",
      commonTokens: 10, // system(8) + user(2) = 10 matching prefix
      minHitRatio: 0.7,
      maxHitRatio: 0.9,
    })
  })

  test("T03: system prompt changed", () => {
    const prev = req(
      ["system prompt A", "rules", "Today's date: June 9, 2026"],
      ["user", "question"],
    )
    const next = req(
      ["system prompt B", "rules", "Today's date: June 9, 2026"],
      ["user", "question"],
    )
    const report = computeDivergence(prev, next)
    expect(report.divergenceCause).toBe("system_prompt_changed")
    // "system prompt" matches (2 tokens), then "A" vs "B" diverges
    expect(report.commonTokens).toBe(2)
  })

  test("T04: date changed", () => {
    const prev = req(
      ["system prompt", "rules", "Today's date: June 9, 2026"],
      ["user", "question"],
    )
    const next = req(
      ["system prompt", "rules", "Today's date: June 10, 2026"],
      ["user", "question"],
    )
    const report = computeDivergence(prev, next)
    expect(report.divergenceCause).toBe("date_changed")
    // system[0] + system[1] should match
    expect(report.commonTokens).toBeGreaterThan(4)
    // divergence should be in system[2]
    expect(report.divergenceIndex).toBeGreaterThan(0)
  })

  test("T05: message content modified", () => {
    const prev = req(
      ["system prompt", "rules", "date: June 9, 2026"],
      ["user", "write a sort function"],
    )
    const next = req(
      ["system prompt", "rules", "date: June 9, 2026"],
      ["user", "write a search function"],
    )
    const report = computeDivergence(prev, next)
    expect(report.divergenceCause).toBe("message_modified")
    // System tokens match (7), first 2 words of user message match ("write" "a")
    expect(report.commonTokens).toBe(9) // 7 + 2
  })

  test("T06: message removed", () => {
    const prev = req(
      ["s", "r", "d"],
      ["user", "q1"],
      ["assistant", "a1"],
      ["user", "q2"],
    )
    const next = req(
      ["s", "r", "d"],
      ["user", "q1"],
    )
    const report = computeDivergence(prev, next)
    expect(report.divergenceCause).toBe("message_removed")
  })

  test("T07: section reordered", () => {
    const prev = req(
      ["system", "rules", "date"],
      ["user", "## Section A\ncontent\n## Section B\nmore"],
    )
    const next = req(
      ["system", "rules", "date"],
      ["user", "## Section B\nmore\n## Section A\ncontent"],
    )
    const report = computeDivergence(prev, next)
    expect(report.divergenceCause).toBe("section_reordered")
  })

  test("T08: part modified (same section count)", () => {
    const prev = req(
      ["system", "rules", "date"],
      ["user", "replace foo with bar"],
    )
    const next = req(
      ["system", "rules", "date"],
      ["user", "replace foo with baz"],
    )
    const report = computeDivergence(prev, next)
    expect(report.divergenceCause).toBe("message_modified")
    // System + "replace" "foo" "with" = 6 tokens match
    expect(report.commonTokens).toBe(6)
  })

  test("T09: system[1] changed (rules/env change)", () => {
    const prev = req(
      ["system prompt", "rule: do X", "date"],
      ["user", "question"],
    )
    const next = req(
      ["system prompt", "rule: do Y", "date"],
      ["user", "question"],
    )
    const report = computeDivergence(prev, next)
    expect(report.divergenceCause).toBe("system_prompt_changed")
  })
})

// ── Section Analysis ───────────────────────────────────────────────────────

describe("section analysis", () => {
  test("reports per-section match status", () => {
    const prev = req(
      ["system prompt here"],
      ["user", "question text"],
      ["assistant", "answer text"],
    )
    const next = req(
      ["system prompt here"],
      ["user", "question text"],
      ["assistant", "answer modified"],
    )

    const report = computeDivergence(prev, next)
    expect(report.sections.length).toBeGreaterThanOrEqual(3)

    // system[0] should be fully matched
    const sys0 = report.sections.find((s) => s.section === "system[0]")
    expect(sys0?.matched).toBe(true)

    // user[0] should be fully matched
    const usr0 = report.sections.find((s) => s.section === "user[0]")
    expect(usr0?.matched).toBe(true)

    // assistant[1] (index 1 in messages array) should NOT be fully matched (content changed, divergence within it)
    const ast = report.sections.find((s) => s.section === "assistant[1]")
    expect(ast).toBeDefined()
    // It diverged within this section
    expect(ast!.matched).toBe(false)
  })
})

// ── Edge Cases ─────────────────────────────────────────────────────────────

describe("edge cases", () => {
  test("empty messages → still computes divergence on system", () => {
    const prev = reqEmpty(["system A"])
    const next = reqEmpty(["system A"])
    const report = computeDivergence(prev, next)
    expect(report.divergenceCause).toBe("identical")
    expect(report.expectedHitRatio).toBe(1.0)
  })

  test("empty system → divergence in user message", () => {
    const prev: Request = { system: [], messages: [{ role: "user", content: "hello" }] }
    const next: Request = { system: [], messages: [{ role: "user", content: "world" }] }
    const report = computeDivergence(prev, next)
    expect(report.divergenceCause).toBe("message_modified")
    expect(report.commonTokens).toBe(0)
  })

  test("no previous request → reports 0% baseline", () => {
    // This is the "first compaction" case — no baseline to compare against
    const next = req(["system"], ["user", "first message"])
    // When prev is empty (no prior request), we treat it as no cache available
    const emptyPrev: Request = { system: [], messages: [] }
    const report = computeDivergence(emptyPrev, next)
    expect(report.commonTokens).toBe(0)
    expect(report.expectedHitRatio).toBe(0)
  })

  test("date with different format still detected", () => {
    const prev = req(
      ["system", "rules", "  Today's date: Jun 9, 2026"],
      ["user", "question"],
    )
    const next = req(
      ["system", "rules", "  Today's date: Jun 10, 2026"],
      ["user", "question"],
    )
    const report = computeDivergence(prev, next)
    expect(report.divergenceCause).toBe("date_changed")
  })
})
