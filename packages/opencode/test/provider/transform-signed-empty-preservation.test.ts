import { describe, expect, test } from "bun:test"
import { createAnthropic } from "@ai-sdk/anthropic"
import { generateText } from "ai"
import { ProviderTransform } from "../../src/provider/transform"

// T65 slice 1 (T2 RED): signed/redacted-empty reasoning must survive the
// anthropic+bedrock empty filters. Bare-empty (no opaque metadata) behavior
// is unchanged — that control stays GREEN before and after the fix.
// Owner requirement 2026-10-16: «ничего резать не надо» — signed-empty is the
// protocol-normal empty thinking with signature (Haiku migration guide).
// No live network: capture-fetch fixture only.

function anthropicModel(): any {
  return {
    id: "anthropic/claude-haiku-5-5",
    providerID: "anthropic",
    name: "Claude Haiku 5.5",
    api: { id: "claude-haiku-5-5", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
    capabilities: { reasoning: true, interleaved: false },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    limit: { context: 1_000_000, output: 128_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-10-07",
  }
}

function bedrockModel(): any {
  return {
    ...anthropicModel(),
    id: "amazon-bedrock/anthropic.claude-haiku-5-5",
    providerID: "amazon-bedrock",
    api: {
      id: "anthropic.claude-haiku-5-5",
      url: "https://bedrock-runtime.us-east-1.amazonaws.com",
      npm: "@ai-sdk/amazon-bedrock",
    },
  }
}

function reasoningParts(msgs: any[]) {
  return msgs.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((p: any) => p.type === "reasoning")
}

describe("transform signed-empty preservation (t65 slice 1)", () => {
  test("anthropic: signed-empty reasoning alongside text is preserved", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: { anthropic: { signature: "sig-1" } } },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]
    const out = ProviderTransform.message(msgs, anthropicModel(), {})
    const kept = reasoningParts(out)
    expect(kept.length).toBe(1)
    expect(kept[0].text).toBe("")
  })

  test("anthropic: signed-empty-only message is not dropped", () => {
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "", providerOptions: { anthropic: { signature: "sig-1" } } }],
      },
    ] as any[]
    const out = ProviderTransform.message(msgs, anthropicModel(), {})
    expect(out.length).toBe(1)
    expect(reasoningParts(out).length).toBe(1)
  })

  test("anthropic: redacted-empty reasoning is preserved", () => {
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "", providerOptions: { anthropic: { redactedData: "redacted-1" } } }],
      },
    ] as any[]
    const out = ProviderTransform.message(msgs, anthropicModel(), {})
    expect(reasoningParts(out).length).toBe(1)
  })

  test("anthropic: bare-empty reasoning is still dropped (minimal-change control)", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]
    const out = ProviderTransform.message(msgs, anthropicModel(), {})
    expect(reasoningParts(out).length).toBe(0)
  })

  test("anthropic: nonempty signed reasoning with Unicode is preserved byte-exact", () => {
    const text = "R_α考える🧠"
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text, providerOptions: { anthropic: { signature: "sig-u" } } }],
      },
    ] as any[]
    const out = ProviderTransform.message(msgs, anthropicModel(), {})
    const kept = reasoningParts(out)
    expect(kept.length).toBe(1)
    expect(kept[0].text).toBe(text)
  })

  test("bedrock: amazonBedrock-signed empty is preserved", () => {
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "", providerOptions: { amazonBedrock: { signature: "bed-sig" } } }],
      },
    ] as any[]
    const out = ProviderTransform.message(msgs, bedrockModel(), {})
    expect(reasoningParts(out).length).toBe(1)
  })

  test("bedrock: bedrock-key redactedContent empty is preserved", () => {
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "", providerOptions: { bedrock: { redactedContent: "rc-1" } } }],
      },
    ] as any[]
    const out = ProviderTransform.message(msgs, bedrockModel(), {})
    expect(reasoningParts(out).length).toBe(1)
  })

  test("bedrock: bare-empty reasoning is still dropped (minimal-change control)", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]
    const out = ProviderTransform.message(msgs, bedrockModel(), {})
    expect(reasoningParts(out).length).toBe(0)
  })

  test("instrument control: direct SDK preserves signed-empty without our transform (PASS before fix)", async () => {
    let body: any
    const sdk = createAnthropic({
      apiKey: "fixture-only",
      fetch: (async (_url: any, init: any) => {
        body = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            model: "claude-haiku-5-5",
            content: [{ type: "text", text: "FIXTURE_OK" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { headers: { "content-type": "application/json" } },
        )
      }) as typeof fetch,
    })
    const history = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: { anthropic: { signature: "fixture-signature" } } },
          { type: "text", text: "First answer" },
        ],
      },
      { role: "user", content: "Next turn" },
    ] as any[]
    await generateText({
      model: sdk("claude-haiku-5-5"),
      maxOutputTokens: 512,
      maxRetries: 0,
      messages: history as any,
    })
    const blocks = (body.messages as any[]).flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
    expect(blocks.some((p: any) => p.type === "thinking" && p.thinking === "" && p.signature === "fixture-signature")).toBe(
      true,
    )
  })

  test("wire control: transformed history reaches the SDK with its thinking block (RED before fix)", async () => {
    let body: any
    const sdk = createAnthropic({
      apiKey: "fixture-only",
      fetch: (async (_url: any, init: any) => {
        body = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            model: "claude-haiku-5-5",
            content: [{ type: "text", text: "FIXTURE_OK" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { headers: { "content-type": "application/json" } },
        )
      }) as typeof fetch,
    })
    const history = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: { anthropic: { signature: "fixture-signature" } } },
          { type: "text", text: "First answer" },
        ],
      },
      { role: "user", content: "Next turn" },
    ] as any[]
    const transformed = ProviderTransform.message(structuredClone(history), anthropicModel(), {})
    await generateText({
      model: sdk("claude-haiku-5-5"),
      maxOutputTokens: 512,
      maxRetries: 0,
      messages: transformed as any,
    })
    const blocks = (body.messages as any[]).flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
    expect(blocks.some((p: any) => p.type === "thinking" && p.thinking === "" && p.signature === "fixture-signature")).toBe(
      true,
    )
  })
})
