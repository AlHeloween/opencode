import { describe, expect, test } from "bun:test"
import { rewriteReasoningContent } from "@/provider/gateway/adaptive-client"

/**
 * The gateway's reasoning rewrite, pinned.
 *
 * Its job is narrow: collapse the OpenRouter SDK dialect (`reasoning` plus a
 * duplicate `reasoning_details`) into the single vendor-native field, in the
 * canonical position before `tool_calls`. It runs on every deepseek / glm /
 * z-ai body — including bodies the DeepSeek provider already wrote correctly.
 *
 * On such a body there is no dialect to collapse, and reading the absent pair
 * yields "". Writing that back overwrote the real chain of thought on every
 * tool-call turn. Measured 2026-09-15 on one request: the provider received 32
 * assistant messages carrying reasoning text and the wire carried 0, with
 * `reasoning_content: ""` on all 37. The SDK was correct; this was downstream
 * of it, which is why an oracle aimed at the SDK could not see it.
 */
const parse = (body: string) => JSON.parse(rewriteReasoningContent(body)).messages as Array<Record<string, unknown>>
const body = (messages: unknown[]) => JSON.stringify({ model: "deepseek-flash", messages })

const TOOL_CALLS = [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }]

describe("gateway reasoning rewrite", () => {
  test("native reasoning_content on a tool-call turn survives", () => {
    // The regression. This body is exactly what @ai-sdk/deepseek emits.
    const out = parse(body([{ role: "assistant", content: "a", reasoning_content: "REAL COT", tool_calls: TOOL_CALLS }]))
    expect(out[0].reasoning_content).toBe("REAL COT")
  })

  test("the OpenRouter dialect is still collapsed into the native field", () => {
    const out = parse(
      body([
        {
          role: "assistant",
          content: "a",
          reasoning: "FROM DIALECT",
          reasoning_details: [{ text: "FROM DIALECT" }],
          tool_calls: TOOL_CALLS,
        },
      ]),
    )
    expect(out[0].reasoning_content).toBe("FROM DIALECT")
    expect("reasoning" in out[0]).toBe(false)
    expect("reasoning_details" in out[0]).toBe(false)
  })

  test("an empty dialect does not outrank a real native field", () => {
    // `??` here would pick "" and destroy the thought; `||` falls through.
    const out = parse(
      body([{ role: "assistant", content: "a", reasoning: "", reasoning_content: "REAL COT", tool_calls: TOOL_CALLS }]),
    )
    expect(out[0].reasoning_content).toBe("REAL COT")
  })

  test("the 400-guard holds: a tool-call turn with no CoT anywhere still carries the key", () => {
    const out = parse(body([{ role: "assistant", content: "a", tool_calls: TOOL_CALLS }]))
    expect("reasoning_content" in out[0]).toBe(true)
    expect(out[0].reasoning_content).toBe("")
  })

  test("reasoning_content precedes tool_calls in key order", () => {
    const keys = Object.keys(parse(body([{ role: "assistant", content: "a", reasoning_content: "C", tool_calls: TOOL_CALLS }]))[0])
    expect(keys.indexOf("reasoning_content")).toBeLessThan(keys.indexOf("tool_calls"))
  })

  test("a final answer with no CoT carries no field at all", () => {
    const out = parse(body([{ role: "assistant", content: "done" }]))
    expect("reasoning_content" in out[0]).toBe(false)
  })

  test("a final answer that thought keeps its thought", () => {
    const out = parse(body([{ role: "assistant", content: "done", reasoning_content: "LAST COT" }]))
    expect(out[0].reasoning_content).toBe("LAST COT")
  })

  test("user and tool messages are untouched", () => {
    const out = parse(body([{ role: "user", content: "q" }, { role: "tool", tool_call_id: "c1", content: "r" }]))
    expect(out).toEqual([{ role: "user", content: "q" }, { role: "tool", tool_call_id: "c1", content: "r" }])
  })
})
