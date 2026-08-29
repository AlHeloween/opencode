import { describe, expect, test } from "bun:test"

import { analyzeRawDiff, assembleMessage, collectReasoning, messageSpans, renderIntegrityReport, renderLineDiff, renderRawDiff, renderRawWirePseudoDiff, renderResponseMarkdown, renderWireMessageMd } from "@/provider/gateway/raw-diff"

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

describe("renderLineDiff", () => {
  test("added/removed lines are exact — no normalization", () => {
    const prev = "a\nb\nc\nd\ne\nf\ng"
    const curr = "a\nb\nC2\nd\ne\nf\ng"
    const text = renderLineDiff({ prevId: "p", prevRaw: prev, currId: "c", currRaw: curr })
    expect(text).toContain("--- prev (p)")
    expect(text).toContain("+++ curr (c)")
    expect(text.split("\n")).toContain("-c")
    expect(text.split("\n")).toContain("+C2")
    expect(text).toContain("@@ -1,6 +1,6 @@")
  })

  test("identical bodies are short-circuited", () => {
    const text = renderLineDiff({ prevId: "p", prevRaw: "a\nb", currId: "c", currRaw: "a\nb" })
    expect(text).toContain("bodies identical")
  })

  test("kernel-copy append shows as added lines (the compaction case)", () => {
    const make = (copies: number) =>
      JSON.stringify(
        {
          model: "m",
          messages: Array.from({ length: copies }, () => ({
            role: "system",
            content: [{ type: "text", text: "# Semantic Vector (SV) — kernel body" }],
          })),
        },
        null,
        2,
      )
    // Triplication: one more identical kernel block in curr — a plain line
    // diff surfaces it as added lines (the byte report could not: the copies
    // are identical, only their count grew).
    const text = renderLineDiff({ prevId: "p", prevRaw: make(2), currId: "c", currRaw: make(3) })
    const added = text.split("\n").filter((line) => line.startsWith("+"))
    expect(added.length).toBeGreaterThan(0)
    expect(added.some((line) => line.includes("Semantic Vector (SV)"))).toBe(true)
  })
})

describe("renderIntegrityReport", () => {
  const kernel = "# Semantic Vector (SV)\nkernel body"
  const conforms = {
    model: "m",
    messages: [
      { role: "system", content: "You are Smit." },
      { role: "system", content: [{ type: "text", text: kernel }] },
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        reasoning_content: "thinking",
        tool_calls: [{ id: "t1", function: { name: "f", arguments: "{}" } }],
      },
      { role: "tool", content: "result", tool_call_id: "t1" },
      { role: "assistant", content: "done" },
    ],
  }

  test("canonical flow reports CONFORMS with kernel×1", () => {
    const text = renderIntegrityReport({ body: conforms })
    expect(text).toContain("kernel copies: 1")
    expect(text).toContain("CONFORMS")
    expect(text).not.toContain("VIOLATIONS")
  })

  test("kernel triplication is flagged (compaction regression)", () => {
    const body = {
      messages: [
        { role: "system", content: kernel },
        { role: "system", content: kernel },
        { role: "system", content: kernel },
        { role: "user", content: "go" },
      ],
    }
    const text = renderIntegrityReport({ body })
    expect(text).toContain("kernel copies: 3 (EXPECTED 1 — identity accumulation)")
  })

  test("dual dialect violation", () => {
    const body = {
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "", reasoning: "x", reasoning_details: [{ text: "x" }] },
      ],
    }
    expect(renderIntegrityReport({ body })).toContain("dual dialect")
  })

  test("reasoning_content after tool_calls — order violation", () => {
    const body = {
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "", tool_calls: [{ id: "t" }], reasoning_content: "think" },
      ],
    }
    expect(renderIntegrityReport({ body })).toContain("after tool_calls")
  })

  test("tool-call turn without reasoning_content — 400 guard", () => {
    const body = {
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "", tool_calls: [{ id: "t" }] },
      ],
    }
    expect(renderIntegrityReport({ body })).toContain("without reasoning_content")
  })

  test("empty reasoning_content on a final answer", () => {
    const body = {
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "done", reasoning_content: "" },
      ],
    }
    expect(renderIntegrityReport({ body })).toContain("empty reasoning_content")
  })

  test("non-envelope body is skipped", () => {
    expect(renderIntegrityReport({ body: "raw string" })).toContain("report skipped")
  })
})

describe("assembleMessage", () => {
  const sse = (chunks: unknown[]) =>
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join("\n\n") + "\n\ndata: [DONE]\n\n"

  test("stream: content join, reasoning dedup, tool_calls fragment join, finish/usage", () => {
    const body = sse([
      { choices: [{ delta: { content: "", role: "assistant", reasoning: "thi", reasoning_details: [{ type: "reasoning.text", text: "thi", format: "unknown" }] } }] },
      { choices: [{ delta: { reasoning: "think", reasoning_details: [{ type: "reasoning.text", text: "think" }] } }] },
      { choices: [{ delta: { content: null, tool_calls: [{ index: 0, id: "c1", function: { name: "run", arguments: "{\"a\":" } }] } }] },
      { choices: [{ delta: { content: "done", tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ])
    const message = assembleMessage(body)
    expect(message.content).toBe("done")
    expect(message.reasoning).toBe("think")
    expect(message.toolCalls).toEqual([{ id: "c1", name: "run", arguments: '{"a":1}' }])
    expect(message.finishReason).toBe("tool_calls")
    expect(message.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })
  })

  test("empty-string content deltas accumulate to empty (not null)", () => {
    const body = sse([
      { choices: [{ delta: { content: "", reasoning: "x" } }] },
      { choices: [{ delta: { content: "" }, finish_reason: "tool_calls" }] },
    ])
    expect(assembleMessage(body).content).toBe("")
  })

  test("non-stream completion object passes through whole", () => {
    const body = {
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "hi", reasoning_content: "co", tool_calls: [{ id: "t", function: { name: "f", arguments: "{}" } }] } }],
      usage: { total_tokens: 3 },
    }
    const message = assembleMessage(body)
    expect(message.content).toBe("hi")
    expect(message.reasoning).toBe("co")
    expect(message.finishReason).toBe("stop")
    expect(message.toolCalls).toEqual([{ id: "t", name: "f", arguments: "{}" }])
  })

  test("renderResponseMarkdown writes reasoning, content and tool calls", () => {
    const text = renderResponseMarkdown({
      id: "r1",
      captured: "iso",
      status: 200,
      message: { content: "", reasoning: "thought", toolCalls: [{ id: "c", name: "f", arguments: "{}" }], finishReason: "tool_calls", usage: { prompt_tokens: 7, prompt_tokens_details: { cached_tokens: 6 }, completion_tokens: 2 } },
    })
    expect(text).toContain("finish_reason: tool_calls")
    expect(text).toContain("7 prompt (6 cached) / 2 completion")
    expect(text).toContain("(empty \"\")")
    expect(text).toContain("- [c] f({})")
  })
})

describe("renderRawWirePseudoDiff", () => {
  const assistant = (reasoning: string) => ({
    role: "assistant",
    content: "",
    reasoning_content: reasoning,
    tool_calls: [{ id: "c1", type: "function", function: { name: "t", arguments: "{}" } }],
  })

  test("append-only growth: structure table + ADDED full md blocks", () => {
    const prev = {
      model: "m",
      max_tokens: 100,
      messages: [
        { role: "system", content: [{ type: "text", text: "kernel" }] },
        { role: "user", content: "hi" },
        assistant("think"),
      ],
    }
    const curr = {
      model: "m",
      max_tokens: 200,
      messages: [...prev.messages, { role: "tool", tool_call_id: "c1", content: "42" }, { role: "assistant", content: "done" }],
    }
    const text = renderRawWirePseudoDiff({ prevId: "p", currId: "c", prev, curr })
    expect(text).toContain("== LEVEL 1: JSON structure ==")
    expect(text).toContain("max_tokens: 100 -> 200")
    expect(text).toContain("messages: 3 -> 5 (+2)")
    expect(text).toContain("[0] system | content:parts(1) — unchanged")
    expect(text).toContain("[2] assistant | content:\"\" rc(5) tools(1) — unchanged")
    expect(text).toContain("[3] tool | content:str(2) — ADDED")
    expect(text).toContain("== LEVEL 2: message pseudo-diff (MD) ==")
    expect(text).toContain("[0] system — unchanged")
    expect(text).toContain("[3] tool — ADDED:")
    expect(text).toContain("### tool")
    expect(text).toContain("tool_call_id: c1")
    expect(text).toContain("[4] assistant — ADDED:")
    expect(text).toContain("content (4 chars):")
    expect(text).toContain("done")
  })

  test("changed message routes through the exact line diff", () => {
    const prev = { messages: [assistant("old thought")] }
    const curr = { messages: [assistant("new thought")] }
    const text = renderRawWirePseudoDiff({ prevId: "p", currId: "c", prev, curr })
    expect(text).toContain("[0] assistant | content:\"\" rc(11) tools(1) — CHANGED")
    expect(text).toContain("[0] assistant — CHANGED:")
    expect(text.split("\n")).toContain("-old thought")
    expect(text.split("\n")).toContain("+new thought")
  })

  test("null and empty content render distinctly (null != \"\")", () => {
    const mdNull = renderWireMessageMd({ role: "assistant", content: null, reasoning_content: "" })
    expect(mdNull).toContain("content: null")
    expect(mdNull).toContain("reasoning_content: (empty)")
    const mdEmpty = renderWireMessageMd({ role: "assistant", content: "" })
    expect(mdEmpty).toContain("content: (empty \"\")")
  })

  test("removed message keeps its full md block", () => {
    const prev = { messages: [{ role: "assistant", content: "kept" }, { role: "user", content: "gone" }] }
    const curr = { messages: [{ role: "assistant", content: "kept" }] }
    const text = renderRawWirePseudoDiff({ prevId: "p", currId: "c", prev, curr })
    expect(text).toContain("messages: 2 -> 1 (-1)")
    expect(text).toContain("[1] user | content:str(4) — REMOVED")
    expect(text).toContain("[1] user — REMOVED:")
    expect(text).toContain("gone")
  })
})
