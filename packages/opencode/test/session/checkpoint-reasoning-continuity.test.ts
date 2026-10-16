import { describe, expect, test } from "bun:test"
import { tailMessageText } from "../../src/session/compaction"
import { modelMessageEnd, reusablePrefixLength, takeModelPrefix } from "../../src/session/checkpoint"
import type { MessageV2 } from "../../src/session/message-v2"

// T65 T5 (pins, no product change): the continuity contract.
// - The checkpoint prefix is byte-identical to what conversion produced,
//   opaque providerOptions included; misalignment reconverts, never slices.
// - A model switch addresses its own slot (key carries providerID/modelID —
//   pinned in checkpoint.test.ts "different models have independent
//   checkpoints"); here: prefix reuse never crosses a tool-state change.
// - tailMessageText carries the FULL reasoning text but NO signature: the
//   text-only compact view is not a signed replay (Continuity p.4: the working
//   representation never mints source bytes).
// Paid inference: zero (pure functions only).

function dbMsg(id: string, parts: any[]): MessageV2.WithParts {
  return {
    info: { id, sessionID: "ses-t5" },
    parts,
  } as unknown as MessageV2.WithParts
}

const assistantMsgs = (suffix = "") =>
  [
    { role: "user", content: "q" },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "", providerOptions: { anthropic: { signature: "sig-t5" } } },
        { type: "text", text: `answer${suffix}` },
      ],
    },
  ] as any[]

function checkpointData(messages: any[], ids: string[], toolStates: string[]) {
  return {
    kind: "checkpoint",
    version: 5,
    systemPrompt: [],
    identityFingerprint: "fp",
    messages,
    messageIDs: ids,
    modelMessageCounts: messages.length === ids.length ? ids.map(() => 1) : [1, 1],
    toolReplayStates: toolStates,
    toolReplayState: [],
    wireTurn: 1,
    model: { providerID: "anthropic", modelID: "claude-haiku-5-5" },
    turn: 1,
    timestamp: 0,
  } as any
}

describe("t65 T5 checkpoint prefix pins", () => {
  test("takeModelPrefix returns stored messages byte-identical, opaque included", () => {
    const messages = assistantMsgs()
    const data = checkpointData(messages, ["m-user", "m-assistant"], ["[]", "[]"])
    const prefix = takeModelPrefix(data, 2)
    expect(prefix).toEqual(messages)
    const reasoning = (prefix![1] as any).content.filter((p: any) => p.type === "reasoning")
    expect(reasoning).toHaveLength(1)
    expect(reasoning[0].providerOptions).toEqual({ anthropic: { signature: "sig-t5" } })
  })

  test("reusablePrefixLength reuses only while IDs and tool states match", () => {
    const live = [dbMsg("m-user", []), dbMsg("m-assistant", [])]
    const data = checkpointData(assistantMsgs(), ["m-user", "m-assistant"], ["[]", "[]"])
    // toolReplayState of an empty-part message serializes as "[]".
    expect(reusablePrefixLength(live as any, data, undefined, 1)).toBe(2)
  })

  test("a tool-state change invalidates the prefix (suffix reconverts from DB)", () => {
    const live = [dbMsg("m-user", []), dbMsg("m-assistant", [])]
    const data = checkpointData(assistantMsgs(), ["m-user", "m-assistant"], ["[]", '[["p1",0,"completed"]]'])
    expect(reusablePrefixLength(live as any, data, undefined, 1)).toBeLessThan(2)
  })

  test("misaligned counts return null (legacy slot reconverts, never slices garbage)", () => {
    const messages = assistantMsgs()
    const data = checkpointData(messages, ["m-user", "m-assistant"], ["[]", "[]"])
    data.modelMessageCounts = [1]
    expect(modelMessageEnd(data, 2)).toBeNull()
    expect(takeModelPrefix(data, 2)).toBeNull()
  })
})

describe("t65 T5 compact view is text-only, never a signed replay", () => {
  test("tailMessageText carries the full reasoning text", () => {
    const text = "R_α" + "x".repeat(12_000)
    const out = tailMessageText(dbMsg("m-a", [{ type: "reasoning", text } as any]))
    expect(out).toContain(text)
  })

  test("tailMessageText carries no signature or opaque binding", () => {
    const out = tailMessageText(
      dbMsg("m-a", [
        { type: "reasoning", text: "thinking", metadata: { anthropic: { signature: "sig-t5" } } } as any,
      ]),
    )
    expect(out).not.toContain("sig-t5")
    expect(out).not.toContain("signature")
    expect(out).not.toContain("providerOptions")
  })
})
