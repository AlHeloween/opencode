import { describe, expect, test } from "bun:test"

import { analyzeRawDiff, collectReasoning, messageSpans, renderRawDiff } from "@/provider/gateway/raw-diff"

function body(messages: string[], maxTokens = 100) {
  return JSON.stringify({
    model: "capture-model",
    max_tokens: maxTokens,
    messages: messages.map((content, i) => ({ role: i % 2 ? "assistant" : "user", content })),
  })
}

describe("messageSpans", () => {
  test("spans survive braces/escapes inside JSON strings", () => {
    const raw = JSON.stringify({
      model: "m",
      messages: [
        { role: "user", content: 'text with } and { and "quotes" inside' },
        { role: "assistant", content: "plain" },
      ],
    })
    const spans = messageSpans(raw)
    expect(spans).toHaveLength(2)
    expect(spans[0].role).toBe("user")
    expect(spans[1].role).toBe("assistant")
    expect(raw.slice(spans[0].start, spans[0].end)).toContain("quotes")
  })
})

describe("analyzeRawDiff", () => {
  test("pure append: divergence at message boundary, attaches to the new message", () => {
    const prev = body(["a", "b"])
    const curr = body(["a", "b", "c"])
    const report = analyzeRawDiff(prev, curr)
    expect(report.verdict).toBe("pure-append")
    expect(report.divergenceOffset).toBeGreaterThan(0)
    expect(report.messageIndex).toBe(2)
    expect(report.messageRole).toBe("user")
    expect(report.cachedEstimate).toBe(report.divergenceOffset!)
    expect(report.uncachedEstimate).toBe(report.currLength - report.divergenceOffset!)
  })

  test("insertion inside message k: nothing removed, cache lost from offset", () => {
    const prev = body(["a", "hello world", "c"])
    const curr = body(["a", "hello brave world", "c"])
    const report = analyzeRawDiff(prev, curr)
    // "brave " is a pure insertion — prefix+suffix cover prev entirely, yet the
    // provider prefix cache still dies at the divergence offset.
    expect(report.verdict).toBe("pure-append")
    expect(report.messageIndex).toBe(1)
    expect(report.messageRole).toBe("assistant")
    expect(report.divergenceInMessageOffset).toBeGreaterThan(0)
    expect(report.divergenceInMessageOffset!).toBeLessThan(
      messageSpans(curr)[1].end - messageSpans(curr)[1].start,
    )
  })

  test("substitution inside message k: nothing removed either — still pure-append class, mutation only when bytes removed", () => {
    const prev = body(["a", "hello world", "c"])
    const curr = body(["a", "hellp world", "c"])
    const report = analyzeRawDiff(prev, curr)
    expect(report.verdict).toBe("mutation")
    expect(report.messageIndex).toBe(1)
  })

  test("vanished: tail removed attaches to last surviving message", () => {
    const prev = body(["a", "b", "c"])
    const curr = body(["a"])
    const report = analyzeRawDiff(prev, curr)
    expect(report.verdict).toBe("vanished")
    expect(report.messageIndex).toBe(0)
    expect(report.uncachedEstimate).toBeLessThan(report.currLength)
  })

  test("envelope max_tokens change is masked → identical (cache-neutral)", () => {
    const prev = body(["a", "b"], 100)
    const curr = body(["a", "b"], 200)
    const report = analyzeRawDiff(prev, curr)
    expect(report.verdict).toBe("identical")
    expect(report.divergenceOffset).toBeNull()
  })

  test("envelope model change (not masked) → mutation before messages[]", () => {
    const prev = body(["a", "b"])
    const curr = prev.replace('"model":"capture-model"', '"model":"other-model"')
    const report = analyzeRawDiff(prev, curr)
    expect(report.verdict).toBe("mutation")
    expect(report.messageIndex).toBeNull()
    expect(report.divergenceOffset).toBeGreaterThan(0)
  })

  test("identical bodies: null divergence", () => {
    const report = analyzeRawDiff(body(["a"]), body(["a"]))
    expect(report.verdict).toBe("identical")
    expect(report.divergenceOffset).toBeNull()
  })
})

describe("renderRawDiff", () => {
  test("insertion report has BEFORE/AFTER prettified sections and exact offset", () => {
    const prev = body(["a", "hello world", "c"])
    const curr = body(["a", "hello brave world", "c"])
    const text = renderRawDiff({ prevId: "prev-uuid", prevRaw: prev, currId: "curr-uuid", currRaw: curr })
    expect(text).toContain("RAW-WIRE DIVERGENCE REPORT")
    expect(text).toContain("verdict: pure-append")
    expect(text).toContain("est uncached:")
    expect(text).toContain("@@ BEFORE — message #0 (user, prettified) @@")
    expect(text).toContain("@@ AFTER — message #1 (assistant, prettified")
    expect(text).toContain('"hello brave world"')
    expect(text).toContain("@@ RAW context @")
  })

  test("identical report is short", () => {
    const text = renderRawDiff({ prevId: "p", prevRaw: body(["a"]), currId: "c", currRaw: body(["a"]) })
    expect(text).toContain("bodies identical")
  })

  test("giant content lines are clamped", () => {
    const giant = "x".repeat(5000)
    const text = renderRawDiff({
      prevId: "p",
      prevRaw: body(["a", giant]),
      currId: "c",
      currRaw: body(["a", giant, "c"]),
    })
    expect(text).toContain("(+")
    expect(text.length).toBeLessThan(30000)
  })
})

describe("collectReasoning", () => {
  test("collects delta.reasoning + reasoning_details in order", () => {
    const chunks = [
      { provider: "Z.AI", model: "m", choices: [{ delta: { reasoning: "think" } }] },
      { choices: [{ delta: { reasoning_details: [{ type: "reasoning.text", text: "ing hard" }] } }] },
      { choices: [{ delta: { content: "answer" } }] },
      { usage: { prompt_tokens: 5, completion_tokens: 2 } },
    ]
    const out = collectReasoning(chunks)
    expect(out.text).toBe("thinking hard")
    expect(out.provider).toBe("Z.AI")
    expect(out.model).toBe("m")
    expect(out.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2 })
  })

  test("accumulating reasoning deltas are deduplicated (suffix growth only)", () => {
    const chunks = [
      { choices: [{ delta: { reasoning: "abc" } }] },
      { choices: [{ delta: { reasoning: "abcd" } }] },
      { choices: [{ delta: { reasoning: "abcd" } }] },
    ]
    expect(collectReasoning(chunks).text).toBe("abcd")
  })

  test("SSE string body with data: lines and [DONE]", () => {
    const body = 'data: {"choices":[{"delta":{"reasoning":"hi"}}]}\n\ndata: [DONE]\n\n'
    expect(collectReasoning(body).text).toBe("hi")
  })

  test("non-string non-array body is ignored", () => {
    expect(collectReasoning(42).text).toBe("")
    expect(collectReasoning(null).text).toBe("")
  })
})
