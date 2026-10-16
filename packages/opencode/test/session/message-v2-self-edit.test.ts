import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Flag, resetConfig } from "@opencode-ai/core/flag/flag"
import { MessageV2, clearConversionCache } from "../../src/session/message-v2"
import { messageMd5 } from "@/session/self-edit"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import type { Provider } from "@/provider/provider"

/**
 * P1b — the directive rides the replay path behind an OFF switch.
 *
 * The agent writes the directive as the LEADING block of its next message
 * (owner 2026-10-16). On conversion, with the switch ON, the block is parsed
 * and applied to the immediately previous assistant message only — the
 * stored originals never change, only the copies this conversion walks.
 * Signed thinking of the last turn rides verbatim; a cut aimed at it is
 * refused and the range stands.
 */

const sessionID = SessionID.make("session")
const providerID = ProviderID.make("test")
const model: Provider.Model = {
  id: ModelID.make("test-model"),
  providerID,
  api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/openai" },
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
  limit: { context: 0, input: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function assistant(id: string, parts: MessageV2.Part[]): MessageV2.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      time: { created: 0 },
      parentID: "msg_parent",
      providerID: "test",
      modelID: "test-model",
      agent: "build",
      mode: "",
    } as unknown as MessageV2.Info,
    parts,
  }
}

function textPart(messageID: string, text: string): MessageV2.Part {
  return {
    id: PartID.ascending(),
    sessionID,
    messageID,
    type: "text",
    text,
  } as unknown as MessageV2.Part
}

function reasoningPart(messageID: string, text: string, metadata?: Record<string, unknown>): MessageV2.Part {
  return {
    id: PartID.ascending(),
    sessionID,
    messageID,
    type: "reasoning",
    text,
    ...(metadata ? { metadata } : {}),
    time: { start: 0 },
  } as unknown as MessageV2.Part
}

const N1_TEXT = ["l1 keep", "l2 cut me", "l3 cut me", "l4 keep", "l5 keep"].join("\n")

function wireTexts(msgs: { role: string; content: { type: string; text?: string }[] }[], id: string): string {
  // Converted UIMessages carry no id and put chunks in `content`.
  const assistants = msgs.filter((m) => m.role === "assistant")
  const msg = assistants[id === "msg_prev" ? 0 : 1]
  if (!msg) return "<missing>"
  return msg.content
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n")
}

describe("self-edit replay hook", () => {
  beforeEach(() => resetConfig())
  afterEach(() => resetConfig())

  function pair(directiveBody: string, prevParts?: MessageV2.Part[]) {
    const prev = assistant("msg_prev", prevParts ?? [textPart("msg_prev", N1_TEXT)])
    const cur = assistant("msg_cur", [textPart("msg_cur", directiveBody)])
    return { prev, cur }
  }

  function directiveFor(text: string, extra = ""): string {
    const md5 = messageMd5(text)
    return (
      `EXCERPT ${md5}\nCUT lines: 2-3\nREASON: status chatter\nSIGNED: cut\n` + extra
    )
  }

  test("OFF: a directive block rides through untouched, bytes as before P1b", async () => {
    const { prev, cur } = pair(`${directiveFor(N1_TEXT)}\nReal continuation text.`)
    const msgs = await MessageV2.toModelMessages([prev, cur], model)
    expect(wireTexts(msgs as never[], "msg_cur")).toContain("EXCERPT")
    expect(wireTexts(msgs as never[], "msg_cur")).toContain("Real continuation text.")
    expect(wireTexts(msgs as never[], "msg_prev")).toBe(N1_TEXT)
  })

  test("ON: a valid directive narrows N-1 and the block leaves the replay", async () => {
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    const { prev, cur } = pair(`${directiveFor(N1_TEXT)}\nReal continuation text.`)
    const msgs = await MessageV2.toModelMessages([prev, cur], model)
    expect(wireTexts(msgs as never[], "msg_prev")).toBe("l1 keep\nl4 keep\nl5 keep")
    const curText = wireTexts(msgs as never[], "msg_cur")
    expect(curText).not.toContain("EXCERPT")
    expect(curText).toContain("Real continuation text.")
  })

  test("ON: a malformed block is refused visibly (P1c supersedes silent ignore)", async () => {
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    const { prev, cur } = pair("EXCERPT not-a-hash\nCUT lines: 2-3\n restrict.")
    const msgs = await MessageV2.toModelMessages([prev, cur], model)
    expect(wireTexts(msgs as never[], "msg_prev")).toBe(N1_TEXT)
    expect(wireTexts(msgs as never[], "msg_cur")).toContain("[self-edit refused:")
  })

  test("ON: signed reasoning of the last turn rides verbatim, the cut is refused", async () => {
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    const signed = reasoningPart("msg_prev", "opaque thought", { anthropic: { signature: "SIG100" } })
    const { prev, cur } = pair(
      `${directiveFor("opaque thought")}\nReal continuation text.`,
      [signed, textPart("msg_prev", N1_TEXT)],
    )
    const msgs = await MessageV2.toModelMessages([prev, cur], model)
    // The text part is untouched: any cut is refused while a signed block stands.
    expect(wireTexts(msgs as never[], "msg_prev")).toContain(N1_TEXT)
  })

  test("ON: a directive for a foreign hash is refused visibly (P1c supersedes)", async () => {
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    const foreign = "EXCERPT 00000000000000000000000000000000\nCUT lines: 2-3\nREASON: x\nSIGNED: cut\n\nRest."
    const { prev, cur } = pair(foreign)
    const msgs = await MessageV2.toModelMessages([prev, cur], model)
    expect(wireTexts(msgs as never[], "msg_prev")).toBe(N1_TEXT)
    expect(wireTexts(msgs as never[], "msg_cur")).toContain("[self-edit refused:")
  })

  test("ON: a snippet-addressed cut resolves without tags", async () => {
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    const md5 = messageMd5(N1_TEXT)
    const body =
      `EXCERPT ${md5}\nCUT lines: 2-3\nCUT start: "l2 cut me"\nCUT end: "l3 cut me"\nREASON: chatter\nSIGNED: cut\n\nTail.`
    const { prev, cur } = pair(body)
    const msgs = await MessageV2.toModelMessages([prev, cur], model)
    expect(wireTexts(msgs as never[], "msg_prev")).toBe("l1 keep\nl4 keep\nl5 keep")
  })

  test("ON: erratum-only directive keeps the text and appends the correction", async () => {
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    const md5 = messageMd5(N1_TEXT)
    const body = `EXCERPT ${md5}\nCUT lines: none\nREASON: no cut, one correction\nSIGNED: keep\nERRATUM after 1: l1 is stale\n\nTail.`
    const { prev, cur } = pair(body)
    const msgs = await MessageV2.toModelMessages([prev, cur], model)
    const prevText = wireTexts(msgs as never[], "msg_prev")
    expect(prevText).toContain("l2 cut me")
    expect(prevText).toContain("l1 is stale")
  })

  test("released results keep a one-line negative result behind the switch", async () => {
    const tool = {
      id: PartID.ascending(),
      sessionID,
      messageID: "msg_prev",
      type: "tool",
      tool: "grep",
      callID: "call_1",
      state: {
        status: "completed",
        input: {},
        output: "line1\nline2\nline3\nline4\nline5\nline6\nline7",
        title: "search",
        time: {},
        released: { reason: "nothing useful for the task" },
      },
    } as unknown as MessageV2.Part
    const prev = assistant("msg_prev", [tool])
    const off = await MessageV2.toModelMessages([prev], model)
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    clearConversionCache()
    const on = await MessageV2.toModelMessages([prev], model)
    const offText = JSON.stringify(off)
    const onText = JSON.stringify(on)
    expect(offText).not.toContain("nothing useful for the task")
    expect(onText).toContain("nothing useful for the task")
  })
})

describe("self-edit refusals are visible (P1c)", () => {
  beforeEach(() => {
    resetConfig()
    clearConversionCache()
  })
  afterEach(() => {
    resetConfig()
    clearConversionCache()
  })

  function pairBody(directiveBody: string) {
    const prev = assistant("msg_prev", [textPart("msg_prev", N1_TEXT)])
    const cur = assistant("msg_cur", [textPart("msg_cur", directiveBody)])
    return { prev, cur }
  }

  test("a blank-covering cut is refused with a visible note, N-1 stands", async () => {
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    const md5 = messageMd5(N1_TEXT)
    const body = `EXCERPT ${md5}\nCUT lines: 1-5\nREASON: wipe it\nSIGNED: cut\n\nTail.`
    const { prev, cur } = pairBody(body)
    const msgs = await MessageV2.toModelMessages([prev, cur], model)
    expect(wireTexts(msgs as never[], "msg_prev")).toBe(N1_TEXT)
    const curText = wireTexts(msgs as never[], "msg_cur")
    expect(curText).toContain("[self-edit refused:")
    expect(curText).toContain("Tail.")
    expect(curText).not.toContain("EXCERPT")
  })

  test("a signed defer is shown, not silent", async () => {
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    const md5 = messageMd5(N1_TEXT)
    const signed = reasoningPart("msg_prev", "opaque thought", { anthropic: { signature: "SIG100" } })
    const prev = assistant("msg_prev", [signed, textPart("msg_prev", N1_TEXT)])
    const cur = assistant("msg_cur", [textPart("msg_cur", `EXCERPT ${md5}\nCUT lines: 2-3\nREASON: x\nSIGNED: cut\n\nTail.`)])
    const msgs = await MessageV2.toModelMessages([prev, cur], model)
    expect(wireTexts(msgs as never[], "msg_prev")).toContain(N1_TEXT)
    expect(wireTexts(msgs as never[], "msg_cur")).toContain("[self-edit refused:")
  })

  test("rollback: OFF and ON-without-directive render byte-identical replays", async () => {
    const plain = assistant("msg_prev", [textPart("msg_prev", N1_TEXT)])
    const off = await MessageV2.toModelMessages([plain], model)
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    clearConversionCache()
    const fresh = assistant("msg_prev", [textPart("msg_prev", N1_TEXT)])
    const on = await MessageV2.toModelMessages([fresh], model)
    // The switch without a directive changes nothing: off = exactly the old behavior.
    expect(JSON.stringify(on)).toBe(JSON.stringify(off))
  })
})
