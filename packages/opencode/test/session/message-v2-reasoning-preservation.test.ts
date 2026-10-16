import { describe, expect, test, beforeEach } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { ProviderTransform } from "@/provider/transform"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"

// T65 slice 2 (T2 RED): message-v2 replay keeps reasoning-only assistants and
// makes the different-model boundary observable; the interleaved dialect
// conversion reports the opaque metadata it cannot carry.
// Owner requirement 2026-10-16: «ничего резать не надо» — reasoning-only is
// history, not an empty delivery. Paid inference: zero (fixtures only).

const sessionID = SessionID.make("session")
const providerID = ProviderID.make("test")
const model: Provider.Model = {
  id: ModelID.make("test-model"),
  providerID,
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
} as unknown as Provider.Model

function userInfo(id: string): MessageV2.User {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "user",
    model: { providerID, modelID: ModelID.make("test") },
    tools: {},
    mode: "",
  } as unknown as MessageV2.User
}

function assistantInfo(
  id: string,
  parentID: string,
  meta?: { providerID: string; modelID: string },
): MessageV2.Assistant {
  const infoModel = meta ?? { providerID: model.providerID, modelID: model.api.id }
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID,
    modelID: infoModel.modelID,
    providerID: infoModel.providerID,
    mode: "",
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as MessageV2.Assistant
}

function basePart(messageID: string, id: string) {
  return {
    id: PartID.make(id),
    sessionID,
    messageID: MessageID.make(messageID),
  }
}

function interleavedModel(): any {
  return {
    id: "test-interleaved-model",
    providerID: "test",
    name: "Test Interleaved",
    api: { id: "test-interleaved-model", url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
    capabilities: { reasoning: true, interleaved: { field: "reasoning_content" } },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    limit: { context: 128_000, output: 8_192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  }
}

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

// Warn-cut oracle: reportCut speaks through Log.Default.warn("cut", event).
// Capture it per test; the capture itself is qualified by the bare-empty
// control below (a cut that fires there proves the hook hears).
const cuts: Array<{ message?: unknown; extra?: Record<string, any> }> = []
const originalWarn = Log.Default.warn
function installCutCapture() {
  cuts.length = 0
  Log.Default.warn = ((message?: any, extra?: Record<string, any>) => {
    cuts.push({ message, extra })
  }) as typeof originalWarn
}
function removeCutCapture() {
  Log.Default.warn = originalWarn
}
function cutKinds(site: string) {
  return cuts.filter((c) => c.message === "cut" && c.extra?.site === site).map((c) => String(c.extra?.kind))
}

describe("message-v2 reasoning preservation (t65 slice 2)", () => {
  beforeEach(() => {
    MessageV2.clearConversionCache()
    cuts.length = 0
  })

  test("forwards a signed reasoning-only assistant with its metadata (same model)", async () => {
    const assistantID = "m-reason-only-signed"
    const input: MessageV2.WithParts[] = [
      {
        info: userInfo("m-user-1"),
        parts: [{ ...basePart("m-user-1", "u1"), type: "text", text: "question" }] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, "m-user-1"),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "reasoning",
            text: "",
            time: { start: 0 },
            metadata: { anthropic: { signature: "sig-only" } },
          },
        ] as MessageV2.Part[],
      },
    ]
    const result = await MessageV2.toModelMessages(input, model)
    const assistant = result.find((m) => m.role === "assistant")
    expect(assistant).toBeDefined()
    const content = (assistant?.content ?? []) as Array<Record<string, any>>
    const reasoning = content.filter((p) => p.type === "reasoning")
    expect(reasoning.length).toBe(1)
    // convertToModelMessages maps UIMessage providerMetadata onto the ModelMessage
    // providerOptions unconditionally (ai/dist index.js) — the chain is intact.
    expect(reasoning[0].providerOptions).toEqual({ anthropic: { signature: "sig-only" } })
  })

  test("forwards an unsigned nonempty reasoning-only assistant", async () => {
    const assistantID = "m-reason-only-plain"
    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(assistantID, "m-user-2"),
        parts: [
          { ...basePart(assistantID, "a1"), type: "reasoning", text: "only process", time: { start: 0 } },
        ] as MessageV2.Part[],
      },
    ]
    const result = await MessageV2.toModelMessages(input, model)
    const assistant = result.find((m) => m.role === "assistant")
    const content = (assistant?.content ?? []) as Array<Record<string, any>>
    expect(content.some((p) => p.type === "reasoning" && p.text === "only process")).toBe(true)
  })

  test("still drops a step-start-only message (minimal-change control)", async () => {
    const assistantID = "m-step-only"
    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(assistantID, "m-user-3"),
        parts: [{ ...basePart(assistantID, "a1"), type: "step-start" }] as MessageV2.Part[],
      },
    ]
    const result = await MessageV2.toModelMessages(input, model)
    expect(result.some((m) => m.role === "assistant")).toBe(false)
  })

  test("different model: signed reasoning-only is forwarded, text intact, foreign metadata not forwarded, input untouched", async () => {
    const assistantID = "m-diff-model"
    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(assistantID, "m-user-4", { providerID: "other", modelID: "other-model" }),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "reasoning",
            text: "",
            time: { start: 0 },
            metadata: { anthropic: { signature: "foreign-sig" } },
          },
        ] as MessageV2.Part[],
      },
    ]
    const before = structuredClone(input)
    installCutCapture()
    try {
      const result = await MessageV2.toModelMessages(input, model)
      const assistant = result.find((m) => m.role === "assistant")
      expect(assistant).toBeDefined()
      const content = (assistant?.content ?? []) as Array<Record<string, any>>
      const reasoning = content.filter((p) => p.type === "reasoning")
      expect(reasoning.length).toBe(1)
      expect(reasoning[0].text).toBe("")
      // The foreign binding must not ride as vendor bytes: convertToModelMessages
      // sets providerOptions from providerMetadata, and none was attached.
      expect(reasoning[0].providerOptions).toBeUndefined()
      expect(cutKinds("message-v2.replay").some((k) => k.includes("different-model"))).toBe(true)
    } finally {
      removeCutCapture()
    }
    expect(input).toEqual(before)
  })

  test("different model keeps text and reasoning, drops only the opaque binding (guard)", async () => {
    const assistantID = "m-diff-mixed"
    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(assistantID, "m-user-5", { providerID: "other", modelID: "other-model" }),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "reasoning",
            text: "plan",
            time: { start: 0 },
            metadata: { anthropic: { signature: "foreign-sig-2" } },
          },
          { ...basePart(assistantID, "a2"), type: "text", text: "answer" },
        ] as MessageV2.Part[],
      },
    ]
    const result = await MessageV2.toModelMessages(input, model)
    const assistant = result.find((m) => m.role === "assistant")
    const content = (assistant?.content ?? []) as Array<Record<string, any>>
    expect(content.some((p) => p.type === "reasoning" && p.text === "plan")).toBe(true)
    expect(content.some((p) => p.type === "text" && p.text === "answer")).toBe(true)
    expect(content.filter((p) => p.type === "reasoning").every((p) => p.providerOptions === undefined)).toBe(true)
  })

  test("interleaved: reasoning text reaches the dialect field and the uncarried opaque block is reported", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "deep thinking", providerOptions: { anthropic: { signature: "sig-il" } } },
          { type: "text", text: "answer" },
        ],
      },
    ] as any[]
    installCutCapture()
    try {
      const result = ProviderTransform.message(msgs, interleavedModel(), {})
      expect((result[0] as any).providerOptions?.openaiCompatible?.reasoning_content).toBe("deep thinking")
      expect(cutKinds("provider.transform").some((k) => k.includes("interleaved"))).toBe(true)
    } finally {
      removeCutCapture()
    }
  })

  test("capture qualification: a bare-empty anthropic drop still reports its cut (hook hears)", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]
    installCutCapture()
    try {
      ProviderTransform.message(msgs, anthropicModel(), {})
      expect(cutKinds("provider.transform").length).toBeGreaterThan(0)
    } finally {
      removeCutCapture()
    }
  })

  test("EXPECTED_FAIL control (A1): the legacy drop mutation loses what the new invariant keeps", async () => {
    const assistantID = "m-legacy-control"
    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(assistantID, "m-user-6"),
        parts: [
          { ...basePart(assistantID, "a1"), type: "reasoning", text: "kept by slice 2", time: { start: 0 } },
        ] as MessageV2.Part[],
      },
    ]
    const result = await MessageV2.toModelMessages(input, model)
    // The old revision: drop assistants whose only part is reasoning.
    const legacy = result.filter(
      (m: any) =>
        m.role !== "assistant" ||
        (Array.isArray(m.content) ? m.content : []).some((p: any) => p.type !== "reasoning"),
    )
    const legacyReasoning = legacy.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter(
      (p: any) => p.type === "reasoning",
    )
    expect(legacyReasoning.length).toBe(0)
    const freshReasoning = result
      .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
      .filter((p: any) => p.type === "reasoning")
    expect(freshReasoning.length).toBe(1)
  })
})
