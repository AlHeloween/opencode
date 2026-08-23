import { describe, expect, test, beforeEach } from "bun:test"
import { Effect } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { MessageV2 } from "../../src/session/message-v2"
import { Checkpoint } from "../../src/session/checkpoint"
import { RequestDiff } from "../../src/session/request-diff"
import type { Provider } from "@/provider/provider"
import type { ModelMessage } from "ai"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionID, MessageID, PartID } from "../../src/session/schema"

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

function assistantInfo(id: string, parentID: string): MessageV2.Assistant {
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    error: undefined,
    parentID,
    modelID: model.api.id,
    providerID: model.providerID,
    mode: "",
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as MessageV2.Assistant
}

function basePart(messageID: string, id: string) {
  return { id: PartID.make(id), sessionID, messageID: MessageID.make(messageID) }
}

/** user → assistant(text + completed tool) — the 1:N expansion case. */
function history(step2: boolean): MessageV2.WithParts[] {
  const msgs: MessageV2.WithParts[] = [
    {
      info: userInfo("msg_u1"),
      parts: [{ ...basePart("msg_u1", "p1"), type: "text", text: "run jobwait" }],
    },
    {
      info: assistantInfo("msg_a1", "msg_u1"),
      parts: [
        { ...basePart("msg_a1", "p2"), type: "reasoning", text: "Let me wait for this.", time: { start: 0, end: 1 } },
        {
          ...basePart("msg_a1", "p3"),
          type: "tool",
          callID: "call_f045d83b8ab24132aa378af0",
          tool: "jobwait",
          state: {
            status: "completed",
            input: { job_ids: ["bash-5"] },
            output: 'bash-5 (done): 20260822T134032Z_e74604f4\r\ninbox=...\\inbox.jsonl',
            title: "Jobwait",
            metadata: {},
            time: { start: 0, end: 1 },
          },
        },
      ],
    },
  ]
  if (step2) {
    msgs.push({
      info: assistantInfo("msg_a2", "msg_u1"),
      parts: [
        { ...basePart("msg_a2", "p4"), type: "reasoning", text: "Waiting for bash-18 too.", time: { start: 1, end: 2 } },
        {
          ...basePart("msg_a2", "p5"),
          type: "tool",
          callID: "call_78943bb5d30b46299e6c275d",
          tool: "jobwait",
          state: {
            status: "completed",
            input: { job_ids: ["bash-18"] },
            output: "bash-18 (done): warning: in the working copy ...",
            title: "Jobwait",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
      ],
    })
  }
  return msgs
}

async function convertWithCounts(
  msgs: MessageV2.WithParts[],
): Promise<{ messages: ModelMessage[]; counts: number[] }> {
  return Effect.runPromise(
    MessageV2.toModelMessagesWithCountsEffect(msgs, model).pipe(Effect.provide(EffectLogger.layer)),
  )
}

describe("prompt-loop ID alignment (request-diff stability)", () => {
  beforeEach(() => {
    MessageV2.clearConversionCache()
  })

  test("per-message WithCounts conversion is payload-identical to batch conversion", async () => {
    const msgs = history(true)
    const batch = await MessageV2.toModelMessages(msgs, model)
    const perMsg = await convertWithCounts(msgs)
    expect(perMsg.messages).toStrictEqual(batch)
    // user=1, assistant-with-tool=2 (assistant + tool roles)
    expect(perMsg.counts).toEqual([1, 2, 2])
  })

  test("model-indexed IDs remove the false remove+add diff between steps", async () => {
    const mkMeta = (turn: number, timestamp: number): RequestDiff.DiffMeta => ({
      sessionID: "ses_tmp_alignment",
      providerID: model.providerID,
      modelID: model.id,
      turn,
      agent: "code",
      timestamp,
    })

    const formatStep = async (step2: boolean) => {
      const msgs = history(step2)
      const converted = await convertWithCounts(msgs)
      const ids = Checkpoint.expandMessageIDs(
        msgs.map((m) => m.info.id),
        converted.counts,
      )
      expect(ids.length).toBe(converted.messages.length)
      return RequestDiff.formatRequest(["sys"], converted.messages, mkMeta(step2 ? 8 : 8, step2 ? 2 : 1), ids)
    }

    const prev = await formatStep(false)
    const curr = await formatStep(true)
    const diff = RequestDiff.diffRequest(prev, curr, mkMeta(8, 1), mkMeta(8, 2))

    // The old tool-result message must NOT be reported as removed/re-added:
    // summary counts zero removals and no "-" snippet lines appear.
    expect(diff).toMatch(/2 added, 0 removed, 0 changed/)
    expect(diff).not.toMatch(/^- \[/m)
    expect(diff).toMatch(/\+ \[assistant\]/)
    expect(diff).toMatch(/2 added, 0 removed/)

    // Regression guard: DB-indexed IDs (the old behavior) DID produce remove+add.
    const msgs = history(true)
    const batchOld = await MessageV2.toModelMessages(msgs, model)
    const dbIndexed = msgs.map((m) => m.info.id)
    const prevOld = RequestDiff.formatRequest(["sys"], batchOld.slice(0, 3), mkMeta(8, 1), dbIndexed.slice(0, 3))
    const currOld = RequestDiff.formatRequest(["sys"], batchOld, mkMeta(8, 2), dbIndexed)
    const diffOld = RequestDiff.diffRequest(prevOld, currOld, mkMeta(8, 1), mkMeta(8, 2))
    expect(diffOld).toMatch(/removed/) // old code produced the false positive
  })

  test("expanded keys stay unique so messageKey never collides", () => {
    const keys = new Set(Checkpoint.expandMessageIDs(["a", "b", "c"], [1, 3, 1]))
    expect(keys.size).toBe(5)
  })
})
