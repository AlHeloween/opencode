import { describe, expect, test } from "bun:test"
import type { AssistantModelMessage, ModelMessage } from "ai"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { ModelID, ProviderID } from "../../src/provider/schema"

/**
 * The empty-reasoning injection is DeepSeek's 400-guard: a tool-call turn whose
 * `reasoning_content` is missing is rejected (re-probed live 2026-09-13 on both
 * deepseek-flash and deepseek-v4-pro). It must fill the hole and it must never
 * overwrite a real chain of thought — raw-wire dumps showed 262k turns leaving
 * with `""`, so the preservation half is the one that needs a standing guard.
 */
const deepseekModel = (apiID: string): Provider.Model => ({
  id: ModelID.zod.parse("deepseek/deepseek-flash"),
  providerID: ProviderID.zod.parse("deepseek"),
  api: { id: apiID, url: "https://api.deepseek.com", npm: "@ai-sdk/deepseek" },
  name: "DeepSeek V4.1 Flash",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0.15, output: 0.6, cache: { read: 0.003, write: 0 } },
  limit: { context: 1_000_000, output: 384_000 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-09-10",
})

const toolCallTurn = (reasoning?: string): ModelMessage => ({
  role: "assistant",
  content: [
    ...(reasoning === undefined ? [] : [{ type: "reasoning" as const, text: reasoning }]),
    { type: "tool-call" as const, toolCallId: "c1", toolName: "read", input: {} },
  ],
})

const reasoningTexts = (msgs: ModelMessage[]) =>
  msgs
    .filter((msg): msg is AssistantModelMessage => msg.role === "assistant")
    .flatMap((msg) => (Array.isArray(msg.content) ? msg.content : []))
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)

describe("ProviderTransform.message — DeepSeek reasoning guard", () => {
  test("fills the 400-guard hole on a tool-call turn that carries no reasoning", () => {
    const out = ProviderTransform.message([toolCallTurn()], deepseekModel("deepseek-flash"), {})
    expect(reasoningTexts(out)).toEqual([""])
  })

  test("never clobbers a real chain of thought", () => {
    const out = ProviderTransform.message([toolCallTurn("REAL_COT")], deepseekModel("deepseek-flash"), {})
    expect(reasoningTexts(out)).toEqual(["REAL_COT"])
  })

  test("guard is scoped to the DeepSeek family and does not leak to other vendors", () => {
    const anthropic = {
      ...deepseekModel("claude-sonnet-5"),
      providerID: ProviderID.zod.parse("anthropic"),
      api: { id: "claude-sonnet-5", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
    }
    expect(reasoningTexts(ProviderTransform.message([toolCallTurn()], anthropic, {}))).toEqual([])
  })
})
