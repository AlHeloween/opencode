import { describe, expect, test } from "bun:test"
import { createDeepSeek } from "@ai-sdk/deepseek"

/**
 * The DeepSeek CoT round-trip contract, measured on the HTTP body.
 *
 * This is the layer the claim lives on. `transform.ts` logs a "reasoning
 * census" over `ModelMessage[]`, which sits ABOVE `convertToDeepSeekChatMessages`
 * — on 2026-09-15 it reported `out.cotText: 71` while the wire carried 107
 * assistant messages with `reasoning_content: ""` and zero characters of
 * thinking. A census above the transform cannot see the transform drop things.
 *
 * Two upstream behaviours are in play, and our patch must keep them apart:
 *
 *  - `index <= lastUserMessageIndex && !isDeepSeekV4` — reasoning older than the
 *    last user message is dropped, EXCEPT for V4 models, which round-trip it.
 *  - `reasoning_content: reasoning ?? (isDeepSeekV4 ? "" : undefined)` — V4 needs
 *    the key present even when empty; DeepSeek 400s on tool turns without it.
 *
 * `patches/@ai-sdk%2Fdeepseek@3.0.26.patch` teaches `isDeepSeekV4` about
 * `deepseek-flash`. It briefly ALSO removed the `!isDeepSeekV4` exception from
 * the drop rule — one hunk cancelling the other, so the guard was installed and
 * the round-trip it was meant to enable was deleted in the same commit.
 */
function captureBody() {
  const seen: { body?: any } = {}
  const provider = createDeepSeek({
    apiKey: "test",
    fetch: (async (_url: unknown, init: { body: string }) => {
      seen.body = JSON.parse(init.body)
      return new Response(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 0,
          model: "test",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as unknown as typeof fetch,
  })
  return { provider, seen }
}

/** Two turns: an old thought below the last user message, a fresh one above it. */
const TWO_TURNS = [
  { role: "user", content: [{ type: "text", text: "first" }] },
  { role: "assistant", content: [{ type: "reasoning", text: "OLD" }, { type: "text", text: "a" }] },
  { role: "user", content: [{ type: "text", text: "second" }] },
  { role: "assistant", content: [{ type: "reasoning", text: "NEW" }, { type: "text", text: "b" }] },
]

async function bodyFor(modelID: string, prompt: unknown[]) {
  const { provider, seen } = captureBody()
  await provider.chat(modelID).doGenerate({ prompt } as never)
  return seen.body.messages as Array<Record<string, unknown>>
}

describe("deepseek CoT reaches the wire", () => {
  test("deepseek-flash returns a thought older than the last user message", async () => {
    // The whole point of the patch. Without it this is "" and the model
    // re-derives from scratch every turn.
    const msgs = await bodyFor("deepseek-flash", TWO_TURNS)
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.reasoning_content)).toEqual(["OLD", "NEW"])
  })

  test("deepseek-v4 keeps the upstream behaviour it always had", async () => {
    const msgs = await bodyFor("deepseek-v4", TWO_TURNS)
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.reasoning_content)).toEqual(["OLD", "NEW"])
  })

  test("the 400-guard holds: a tool turn with no thought still carries the key", async () => {
    // DeepSeek rejects tool-call turns where reasoning_content is absent
    // entirely, so an empty string is required — not an omitted field.
    const msgs = await bodyFor("deepseek-flash", [
      { role: "user", content: [{ type: "text", text: "q" }] },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "c1", toolName: "read", input: { path: "x" } }],
      },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "read", output: { type: "text", value: "y" } }] },
    ])
    const assistant = msgs.find((m) => m.role === "assistant")!
    expect("reasoning_content" in assistant).toBe(true)
    expect(assistant.reasoning_content).toBe("")
  })

  test("a non-V4 model is untouched — the patch is targeted, not blanket", async () => {
    const msgs = await bodyFor("deepseek-chat", TWO_TURNS)
    const assistants = msgs.filter((m) => m.role === "assistant")
    expect(assistants[0].reasoning_content).toBeUndefined()
    expect(assistants[1].reasoning_content).toBe("NEW")
  })
})
