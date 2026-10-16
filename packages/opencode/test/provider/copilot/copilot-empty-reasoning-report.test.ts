import { describe, expect, test } from "bun:test"
import { convertToOpenAICompatibleChatMessages as convertToCopilotMessages } from "@/provider/sdk/copilot/chat/convert-to-openai-compatible-chat-messages"
import * as Log from "@opencode-ai/core/util/log"

// T65 D-S1 (T2 RED): empty-text reasoning parts must not vanish silently in the
// copilot-chat serializer. Contract (slices 1–2): opaque bindings ride when
// present; what contributes nothing is REPORTED via reportCut, never dropped
// silently; no bytes are invented (no fake text, no foreign signatures).
// Paid inference: zero (pure converter fixtures).

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

describe("copilot-chat empty reasoning observability (t65 D-S1)", () => {
  test("empty-text reasoning with copilot opaque keeps the opaque binding on the wire", () => {
    const result = convertToCopilotMessages([
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "",
            providerOptions: { copilot: { reasoningOpaque: "sig-empty" } },
          },
        ],
      },
    ] as any)
    expect(result[0]).toMatchObject({ role: "assistant", reasoning_opaque: "sig-empty" })
  })

  test("empty-text reasoning with nothing to carry is REPORTED, not silent", () => {
    installCutCapture()
    try {
      const result = convertToCopilotMessages([
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "" }],
        },
      ] as any)
      expect(result).toHaveLength(1)
      expect(cutKinds("sdk.copilot-chat").some((k) => k.includes("reasoning"))).toBe(true)
    } finally {
      removeCutCapture()
    }
  })

  test("nonempty reasoning still rides reasoning_content with no cut (control)", () => {
    installCutCapture()
    try {
      const result = convertToCopilotMessages([
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Let me think." },
            { type: "text", text: "Answer" },
          ],
        },
      ] as any)
      expect((result[0] as any).reasoning_content).toBe("Let me think.")
      expect(cutKinds("sdk.copilot-chat")).toEqual([])
    } finally {
      removeCutCapture()
    }
  })

  test("metadata reasoning_content fallback suppresses the cut (nothing lost)", () => {
    installCutCapture()
    try {
      const result = convertToCopilotMessages([
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "" }],
          providerOptions: { openaiCompatible: { reasoning_content: "Need to inspect the file first." } },
        },
      ] as any)
      expect((result[0] as any).reasoning_content).toBe("Need to inspect the file first.")
      expect(cutKinds("sdk.copilot-chat")).toEqual([])
    } finally {
      removeCutCapture()
    }
  })
})
