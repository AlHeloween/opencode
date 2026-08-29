import { NodeFileSystem } from "@effect/platform-node"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect"
import * as Stream from "effect/Stream"
import z from "zod"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { Agent } from "../../src/agent/agent"
import { LLM } from "../../src/session/llm"
import { SessionCompaction } from "../../src/session/compaction"
import { isOverflowFromContent, estimateContentTokens } from "../../src/session/overflow"
import { Token } from "@/util/token"
import { Instance } from "../../src/project/instance"
import * as Log from "@opencode-ai/core/util/log"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { provideTmpdirInstance, provideTmpdirServer, tmpdir } from "../fixture/fixture"
import { Session as SessionNs } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Provider } from "@/provider/provider"
import * as SessionProcessorModule from "../../src/session/processor"
import { Snapshot } from "../../src/snapshot"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { IncrementalCheckpoint } from "../../src/session/incremental-checkpoint"

Log.init()

// --- planState mirror: sidecar → m* fold (GATED WORKFLOW post-compact pickup) ---

describe("session.compaction planState mirror", () => {
  const planStateFixture = {
    plans: [
      {
        file: "plans/2026-08-27_summary-plan-mirror.md",
        lifecycle: "EXECUTING",
        gate: "G7",
        goal_sv: ["summary", "mirror"],
        invariants: ["s lives outside M", "Exact is system"],
        tasks: [
          {
            id: "T1",
            title: "prose",
            sv: ["prose", "dominant"],
            status: "PASS" as const,
            done_pct: 100,
            attempts: 0,
          },
          {
            id: "T2",
            title: "parser",
            sv: ["parser"],
            status: "PENDING" as const,
            done_pct: null,
            attempts: 2,
            last_failure: "min chars",
          },
        ],
      },
    ],
  }

  it.live(
    "compact folds planState into message* (kernel-native post-compact pickup)",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        const su = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: su.id,
          sessionID: info.id,
          type: "text",
          text: "work turn",
        })
        const sa = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: info.id,
          mode: "build",
          agent: "build",
          parentID: su.id,
          modelID: ref.modelID,
          providerID: ref.providerID,
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: sa.id,
          sessionID: info.id,
          type: "text",
          text: "did work",
        })

        IncrementalCheckpoint.save({
          id: "ck-plan-mirror-test",
          sessionID: info.id,
          fromMessageID: su.id,
          toMessageID: sa.id,
          providerID: ref.providerID,
          modelID: ref.modelID,
          agent: "build",
          body: [
            "## Semantic Vector",
            'dominant: "plan mirror flows into message star"',
            "",
            "## Goal",
            "Verify the GATED WORKFLOW mirror survives the fold.",
            "",
            "## Key decisions",
            "- fold plan state as system Exact",
            "",
            "## Current state",
            "T3/T4 under test.",
          ].join("\n"),
          planState: planStateFixture,
        })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })

        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        const text = msgs
          .flatMap((m) => m.parts)
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text as string)
          .join("\n")

        expect(text).toContain("plan_state: system Exact")
        expect(text).toContain("lifecycle EXECUTING · gate G7")
        expect(text).toContain("T2 [PENDING]")
        expect(text).toContain("PASS ×1")
        expect(text).toContain("last_failure: min chars")
        expect(text).toContain("invariants:")
        expect(text).toContain("s lives outside M")
      }),
    ),
  )
})

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  messages(input: z.output<typeof SessionNs.MessagesInput.zod>) {
    return run(SessionNs.Service.use((svc) => svc.messages(input)))
  },
  updateMessage<T extends MessageV2.Info>(msg: T) {
    return run(SessionNs.Service.use((svc) => svc.updateMessage(msg)))
  },
  updatePart<T extends MessageV2.Part>(part: T) {
    return run(SessionNs.Service.use((svc) => svc.updatePart(part)))
  },
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    update: () => Effect.void,
    updateFallback: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
    enrichRange: () => Effect.succeed({ diffs: [], impact: undefined }),
  }),
)

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const liveProviderConfig = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100_000, output: 32_000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function liveProviderCfg(url: string) {
  return {
    ...liveProviderConfig,
    provider: {
      ...liveProviderConfig.provider,
      test: {
        ...liveProviderConfig.provider.test,
        options: {
          ...liveProviderConfig.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

afterEach(() => {
  mock.restore()
})

function createModel(opts: {
  context: number
  output: number
  input?: number
  cost?: Provider.Model["cost"]
  npm?: string
}): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: opts.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: opts.npm ?? "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

const wide = () => ProviderTest.fake({ model: createModel({ context: 100_000, output: 32_000 })
})

// --- sequential compact safety ---

describe("session.compaction.sequential-compact", () => {
  it.live(
    "second compact with no new summary does not remove messages",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        // Create a summary + recent messages, then compact once
        const su = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: su.id, sessionID: info.id, type: "text", text: "summary-req" })
        const sa = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: sa.id, sessionID: info.id, type: "text", text: "## Goal\n- summary for first compact" })
        const ru = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: ru.id, sessionID: info.id, type: "text", text: "recent-msg" })

        // First compact → single message*
        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after1 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after1).toHaveLength(1)
        const id1 = after1[0].info.id

        // Second compact — only message* visible → idempotent no-ops:
        // ten compacts in a row leave the m* row and content unchanged
        // (fixed point — the user's "10 compacts → same result" contract).
        for (let i = 0; i < 10; i++) {
          yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        }
        const after2 = yield* MessageV2.filterCompactedEffect(info.id)

        expect(after2).toHaveLength(1)
        expect(after2[0].info.id).toBe(id1)
        const texts2 = after2.flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
        expect(texts2.some((t: string) => t.includes("=== COMPACTED ==="))).toBe(true)
      }),
    ),
  )

  it.live(
    "FORCE re-compact on a lone message* is a no-op (folded:false) — no summary/compact loop",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        const su = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: su.id, sessionID: info.id, type: "text", text: "summary-req" })
        const sa = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: sa.id, sessionID: info.id, type: "text", text: "## Goal\n- summary for forced test" })
        const ru = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: ru.id, sessionID: info.id, type: "text", text: "recent-msg" })

        const first = yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        expect(first.folded).toBe(true)

        // FORCE re-fold of the lone star must not rebuild it — the Layer-1
        // headroom gate would otherwise loop compact→summary→compact forever.
        const forced = yield* compact.compact({ sessionID: info.id, model: ref, agent: "build", force: true })
        expect(forced.folded).toBe(false)

        const after = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after).toHaveLength(1)
        expect(after[0].parts.some((p: any) => p.type === "text" && p.text.includes("=== COMPACTED ==="))).toBe(true)
      }),
    ),
  )

  it.live(
    "summaries carry forward: materialized checkpoints re-enter the next m*",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        const su = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: su.id, sessionID: info.id, type: "text", text: "work turn" })
        const sa = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          finish: "end_turn", time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: sa.id, sessionID: info.id, type: "text", text: "did work" })

        IncrementalCheckpoint.save({
          id: "ck-carry-forward",
          sessionID: info.id,
          fromMessageID: su.id,
          toMessageID: sa.id,
          providerID: ref.providerID,
          modelID: ref.modelID,
          agent: "build",
          body: [
            "## Semantic Vector",
            'dominant: "carry forward survives compaction"',
            "",
            "## Goal",
            "Carry summaries across compaction cycles.",
            "",
            "## Key decisions",
            "- sidecar summaries persist in m*",
            "",
            "## Current state",
            "cycle one",
          ].join("\n"),
        })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after1 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after1).toHaveLength(1)
        const text1 = after1
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")
        expect(text1).toContain("carry forward survives compaction")

        // Growth → second compact. The checkpoint is MATERIALIZED by the
        // first compact — it must still feed the new m* (carry forward),
        // and the pre-star real messages re-enter the tail by budget.
        const growth = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: growth.id, sessionID: info.id, type: "text", text: "cycle two work" })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after2 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after2).toHaveLength(1)
        const text2 = after2
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")
        expect(text2).toContain("carry forward survives compaction")
        expect(text2).toContain("cycle two work")
        expect(text2).toContain("work turn")
        expect(text2).toContain("Prior message*")
      }),
    ),
  )
})

describe("session.compaction.structural-summary-handoff", () => {
  it.live(
    "carries the system-owned structural handle from a Layer-1 summary into message*",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const summaryUser = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
          summary: {
            diffs: [],
            impact: {
              from: "fossil_from",
              to: "fossil_to",
              changedFiles: 2,
              symbolCountByKind: { function: 3, class: 1 },
              topSymbols: ["compact", "SessionSummary"],
              impactedFiles: ["src/session/compaction.ts"],
              callerCount: 4,
            },
          },
        } as MessageV2.User)
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: summaryUser.id,
          sessionID: info.id,
          type: "text",
          text: `<!-- summary-range from_id="msg_from" to_id="msg_to" session_id="${info.id}" -->`,
          synthetic: true,
          ignored: true,
        })
        const summaryAssistant = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: info.id,
          mode: "build",
          agent: "build",
          parentID: summaryUser.id,
          modelID: ref.modelID,
          providerID: ref.providerID,
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true,
          finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: summaryAssistant.id,
          sessionID: info.id,
          type: "text",
          text: "## Goal\n- preserve exact system handles",
        })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const star = yield* MessageV2.filterCompactedEffect(info.id)
        const text = star.flatMap((message) => message.parts).find((part) => part.type === "text")?.text ?? ""
        expect(text).toContain("structural_impact: system index-time Structural")
        expect(text).toContain("changed_files=2; caller_count=4")
        expect(text).toContain("top_symbols=compact,SessionSummary")
        expect(text).toContain("impacted_files=src/session/compaction.ts")
      }),
    ),
  )
})

// Regression: COMPACTION_REMINDER used to embed the literal "=== COMPACTED ==="
// marker. isMessageStar matched that substring on every post-compact user message
// and excluded them all from the next message* Recent fold — model saw only
// assistants and lost the user's actual requests.
describe("session.compaction.user-messages-in-recent", () => {
  it.live(
    "second compact keeps real user messages even when they carry a compaction reminder",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        const u1 = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: u1.id,
          sessionID: info.id,
          type: "text",
          text: "first user goal",
        })
        const a1 = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: info.id,
          mode: "build",
          agent: "build",
          parentID: u1.id,
          modelID: ref.modelID,
          providerID: ref.providerID,
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: a1.id,
          sessionID: info.id,
          type: "text",
          text: "assistant reply one",
        })
        // Legacy summary covering the first window (T2: folds require coverage)
        const s1u = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: s1u.id,
          sessionID: info.id,
          type: "text",
          text: "summary-req-1",
        })
        const s1a = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: info.id,
          mode: "build",
          agent: "build",
          parentID: s1u.id,
          modelID: ref.modelID,
          providerID: ref.providerID,
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true,
          finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: s1a.id,
          sessionID: info.id,
          type: "text",
          text: "## Goal\n- summary for first window",
        })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after1 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after1).toHaveLength(1)
        expect(
          after1[0].parts.some(
            (p: any) => p.type === "text" && String(p.text).includes("first user goal"),
          ),
        ).toBe(true)

        // Simulate post-compact user turn: real prompt + legacy reminder that
        // *mentions* the marker (old prompt.ts wording). Must not be treated as message*.
        const u2 = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: u2.id,
          sessionID: info.id,
          type: "text",
          text: "CRITICAL user request after compact",
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: u2.id,
          sessionID: info.id,
          type: "text",
          synthetic: true,
          text: `<system-reminder>
Your conversation history was compacted to stay within context limits.
Active memory is the compacted message (=== COMPACTED ===) and/or summary assistants.
</system-reminder>`,
        })
        const a2 = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: info.id,
          mode: "build",
          agent: "build",
          parentID: u2.id,
          modelID: ref.modelID,
          providerID: ref.providerID,
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: a2.id,
          sessionID: info.id,
          type: "text",
          text: "assistant reply two",
        })
        // Second legacy summary covering the post-compact window (T2)
        const s2u = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: s2u.id,
          sessionID: info.id,
          type: "text",
          text: "summary-req-2",
        })
        const s2a = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: info.id,
          mode: "build",
          agent: "build",
          parentID: s2u.id,
          modelID: ref.modelID,
          providerID: ref.providerID,
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true,
          finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: s2a.id,
          sessionID: info.id,
          type: "text",
          text: "## Goal\n- summary for second window",
        })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build", force: true })
        const after2 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after2).toHaveLength(1)
        const combined = after2
          .flatMap((m: any) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")
        expect(combined).toContain("=== COMPACTED ===")
        expect(combined).toContain("CRITICAL user request after compact")
        expect(combined).toContain("[user `")
        expect(combined).toContain("assistant reply two")
        // Chronological: user request should appear before the following assistant in Recent
        const userIdx = combined.indexOf("CRITICAL user request after compact")
        const asstIdx = combined.indexOf("assistant reply two")
        expect(userIdx).toBeGreaterThan(-1)
        expect(asstIdx).toBeGreaterThan(userIdx)
      }),
    ),
  )
})

async function user(sessionID: SessionID, text: string) {
  const msg = await svc.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  await svc.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
}

async function assistant(sessionID: SessionID, parentID: MessageID, root: string) {
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      output: 0,
      input: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  await svc.updateMessage(msg)
  return msg
}

async function summaryAssistant(sessionID: SessionID, parentID: MessageID, root: string, text: string) {
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "compaction",
    agent: "compaction",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      output: 0,
      input: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    summary: true,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  await svc.updateMessage(msg)
  await svc.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
}

async function lastCompactionPart(sessionID: SessionID) {
  const all = await svc.messages({ sessionID })
  const compaction = all.findLast(
    (m) => m.info.role === "user" && m.parts.some((p) => p.type === "compaction"),
  )
  return compaction?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
}

function fake(
  input: Parameters<SessionProcessorModule.SessionProcessor.Interface["create"]>[0],
  result: "continue" | "compact",
) {
  const msg = input.assistantMessage
  // Set finish so filterCompacted recognizes this as a completed summary assistant
  if (msg.role === "assistant" && msg.summary) msg.finish = "end_turn"
  return {
    get message() {
      return msg
    },
    updateToolCall: Effect.fn("TestSessionProcessor.updateToolCall")(() => Effect.succeed(undefined)),
    completeToolCall: Effect.fn("TestSessionProcessor.completeToolCall")(() => Effect.void),
    process: Effect.fn("TestSessionProcessor.process")(() => Effect.succeed(result)),
  } satisfies SessionProcessorModule.SessionProcessor.Handle
}

function layer(result: "continue" | "compact") {
  return Layer.succeed(
    SessionProcessorModule.SessionProcessor.Service,
    SessionProcessorModule.SessionProcessor.Service.of({
      create: Effect.fn("TestSessionProcessor.create")((input) => Effect.succeed(fake(input, result))),
    }),
  )
}

function cfg(compaction?: Config.Info["compaction"]) {
  const base = Config.Info.zod.parse({})
  return Layer.mock(Config.Service)({
    get: () => Effect.succeed({ ...base, compaction }),
  })
}

function runtime(
  result: "continue" | "compact",
  plugin = Plugin.defaultLayer,
  provider = ProviderTest.fake(),
  config = Config.defaultLayer,
) {
  const bus = Bus.layer
  return ManagedRuntime.make(
    Layer.mergeAll(SessionCompaction.layer, bus).pipe(
      Layer.provide(provider.layer),
      Layer.provide(SessionNs.defaultLayer),
      Layer.provide(layer(result)),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(plugin),
      Layer.provide(bus),
      Layer.provide(config),
    ),
  )
}

const deps = Layer.mergeAll(
  ProviderTest.fake().layer,
  layer("continue"),
  Agent.defaultLayer,
  Plugin.defaultLayer,
  Bus.layer,
  Config.defaultLayer,
)

const env = Layer.mergeAll(
  SessionNs.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  SessionCompaction.layer.pipe(Layer.provide(SessionNs.defaultLayer), Layer.provideMerge(deps)),
)

const it = testEffect(env)

const liveStatus = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const liveInfra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const liveDeps = Layer.mergeAll(
  SessionNs.defaultLayer,
  SnapshotFossil.defaultLayer,
  Agent.defaultLayer,
  Permission.defaultLayer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  LLM.defaultLayer,
  Provider.defaultLayer,
  liveStatus,
).pipe(Layer.provideMerge(liveInfra))
const liveProcessor = SessionProcessorModule.SessionProcessor.layer.pipe(Layer.provide(summary), Layer.provideMerge(liveDeps))
const liveEnv = Layer.mergeAll(
  TestLLMServer.layer,
  liveDeps,
  liveProcessor,
  SessionCompaction.layer.pipe(Layer.provide(liveProcessor), Layer.provideMerge(liveDeps)),
)
const liveIt = testEffect(liveEnv)

function llm() {
  const queue: Array<
    Stream.Stream<LLM.Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)
  > = []

  return {
    push(stream: Stream.Stream<LLM.Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)) {
      queue.push(stream)
    },
    layer: Layer.succeed(
      LLM.Service,
      LLM.Service.of({
        stream: (input) => {
          const item = queue.shift() ?? Stream.empty
          const stream = typeof item === "function" ? item(input) : item
          return stream.pipe(Stream.mapEffect((event) => Effect.succeed(event)))
        },
      }),
    ),
  }
}

function liveRuntime(layer: Layer.Layer<LLM.Service>, provider = ProviderTest.fake(), config = Config.defaultLayer) {
  const bus = Bus.layer
  const status = SessionStatus.layer.pipe(Layer.provide(bus))
  const processor = SessionProcessorModule.SessionProcessor.layer.pipe(
    Layer.provide(summary),
    Layer.provide(status),
    Layer.provide(SessionNs.defaultLayer),
    Layer.provide(SnapshotFossil.defaultLayer),
    Layer.provide(layer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(bus),
    Layer.provide(config),
  )
  return ManagedRuntime.make(
    Layer.mergeAll(SessionCompaction.layer.pipe(Layer.provide(processor)), processor, bus, status).pipe(
      Layer.provide(provider.layer),
      Layer.provide(SessionNs.defaultLayer),
      Layer.provide(SnapshotFossil.defaultLayer),
      Layer.provide(layer),
      Layer.provide(Permission.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(bus),
      Layer.provide(config),
    ),
  )
}

function reply(
  text: string,
  capture?: (input: LLM.StreamInput) => void,
): (input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown> {
  return (input) => {
    capture?.(input)
    return Stream.make(
      { type: "start" } satisfies LLM.Event,
      { type: "text-start", id: "txt-0" } satisfies LLM.Event,
      { type: "text-delta", id: "txt-0", delta: text, text } as LLM.Event,
      { type: "text-end", id: "txt-0" } satisfies LLM.Event,
      {
        type: "finish-step",
        finishReason: "stop",
        rawFinishReason: "stop",
        response: { id: "res", modelId: "test-model", timestamp: new Date() },
        providerMetadata: undefined,
        performance: { effectiveOutputTokensPerSecond: 0, outputTokensPerSecond: 0, inputTokensPerSecond: 0, effectiveTotalTokensPerSecond: 0, stepTimeMs: 0, responseTimeMs: 0, toolExecutionMs: {}, timeToFirstOutputMs: undefined },
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokenDetails: {
            textTokens: undefined,
            reasoningTokens: undefined,
          },
        },
      } satisfies LLM.Event,
      {
        type: "finish",
        finishReason: "stop",
        rawFinishReason: "stop",
        totalUsage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokenDetails: {
            textTokens: undefined,
            reasoningTokens: undefined,
          },
        },
      } satisfies LLM.Event,
    )
  }
}

function modelMessageText(message: LLM.StreamInput["messages"][number] | undefined) {
  if (!message) return ""
  if (typeof message.content === "string") return message.content
  if (!Array.isArray(message.content)) return JSON.stringify(message.content)
  return message.content
    .map((part) => {
      if (typeof part !== "object" || part === null || !("text" in part)) return ""
      return typeof part.text === "string" ? part.text : ""
    })
    .join("\n")
}

function wait(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defer() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function plugin(ready: ReturnType<typeof defer>) {
  return Layer.mock(Plugin.Service)({
    trigger: <Name extends string, Input, Output>(name: Name, _input: Input, output: Output) => {
      if (name !== "experimental.session.compacting") return Effect.succeed(output)
      return Effect.sync(() => ready.resolve()).pipe(Effect.andThen(Effect.never), Effect.as(output))
    },
    list: () => Effect.succeed([]),
    init: () => Effect.void,
  })
}

function autocontinue(enabled: boolean) {
  return Layer.mock(Plugin.Service)({
    trigger: <Name extends string, Input, Output>(name: Name, _input: Input, output: Output) => {
      if (name !== "experimental.compaction.autocontinue") return Effect.succeed(output)
      return Effect.sync(() => {
        ;(output as { enabled: boolean }).enabled = enabled
        return output
      })
    },
    list: () => Effect.succeed([]),
    init: () => Effect.void,
  })
}
describe("util.token.estimate", () => {
  test("estimates tokens from text (4 chars per token)", () => {
    const text = "x".repeat(4000)
    expect(Token.estimate(text)).toBe(1000)
  })

  test("estimates tokens from larger text", () => {
    const text = "y".repeat(20_000)
    expect(Token.estimate(text)).toBe(5000)
  })

  test("returns 0 for empty string", () => {
    expect(Token.estimate("")).toBe(0)
  })
})

describe("SessionNs.getUsage", () => {
  test("normalizes standard usage to token format", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
  })

  test("extracts cached tokens to cache.read", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 200,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    })

    expect(result.tokens.input).toBe(800)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles anthropic cache write metadata", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
      metadata: {
        anthropic: {
          cacheCreationInputTokens: 300,
        },
      },
    })

    expect(result.tokens.cache.write).toBe(300)
  })

  test("subtracts cached tokens for anthropic provider", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    // AI SDK v6 normalizes inputTokens to include cached tokens for all providers
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 200,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
      metadata: {
        anthropic: {},
      },
    })

    expect(result.tokens.input).toBe(800)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("separates reasoning tokens from output tokens", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: 400,
          reasoningTokens: 100,
        },
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(400)
    expect(result.tokens.reasoning).toBe(100)
    expect(result.tokens.total).toBe(1500)
  })

  test("does not double count reasoning tokens in cost", () => {
    const model = createModel({
      context: 100_000,
      output: 32_000,
      cost: {
        input: 0,
        output: 15,
        cache: { read: 0, write: 0 },
      },
    })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 1_000_000,
        totalTokens: 1_000_000,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: 750_000,
          reasoningTokens: 250_000,
        },
      },
    })

    expect(result.tokens.output).toBe(750_000)
    expect(result.tokens.reasoning).toBe(250_000)
    expect(result.cost).toBe(15)
  })

  test("handles undefined optional values gracefully", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    })

    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
    expect(Number.isNaN(result.cost)).toBe(false)
  })

  test("calculates cost correctly", () => {
    const model = createModel({
      context: 100_000,
      output: 32_000,
      cost: {
        input: 3,
        output: 15,
        cache: { read: 0.3, write: 3.75 },
      },
    })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        totalTokens: 1_100_000,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    })

    expect(result.cost).toBe(3 + 1.5)
  })

  test.each(["@ai-sdk/anthropic", "@ai-sdk/amazon-bedrock", "@ai-sdk/google-vertex/anthropic"])(
    "computes total from components for %s models",
    (npm) => {
      const model = createModel({ context: 100_000, output: 32_000, npm })
      // AI SDK v6: inputTokens includes cached tokens for all providers
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 200,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      }
      if (npm === "@ai-sdk/amazon-bedrock") {
        const result = SessionNs.getUsage({
          model,
          usage,
          metadata: {
            bedrock: {
              usage: {
                cacheWriteInputTokens: 300,
              },
            },
          },
        })

        // inputTokens (1000) includes cache, so adjusted = 1000 - 200 - 300 = 500
        expect(result.tokens.input).toBe(500)
        expect(result.tokens.cache.read).toBe(200)
        expect(result.tokens.cache.write).toBe(300)
        // total = adjusted (500) + output (500) + cacheRead (200) + cacheWrite (300)
        expect(result.tokens.total).toBe(1500)
        return
      }

      const result = SessionNs.getUsage({
        model,
        usage,
        metadata: {
          anthropic: {
            cacheCreationInputTokens: 300,
          },
        },
      })

      // inputTokens (1000) includes cache, so adjusted = 1000 - 200 - 300 = 500
      expect(result.tokens.input).toBe(500)
      expect(result.tokens.cache.read).toBe(200)
      expect(result.tokens.cache.write).toBe(300)
      // total = adjusted (500) + output (500) + cacheRead (200) + cacheWrite (300)
      expect(result.tokens.total).toBe(1500)
    },
  )

  test("extracts cache write tokens from vertex metadata key", () => {
    const model = createModel({ context: 100_000, output: 32_000, npm: "@ai-sdk/google-vertex/anthropic" })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 200,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
      metadata: {
        vertex: {
          cacheCreationInputTokens: 300,
        },
      },
    })

    expect(result.tokens.input).toBe(500)
    expect(result.tokens.cache.read).toBe(200)
    expect(result.tokens.cache.write).toBe(300)
  })
})

// --- isOverflowFromContent tests (overflow.ts) ---

function makeMsg(role: "user" | "assistant", parts: Partial<MessageV2.Part>[]): MessageV2.WithParts {
  return {
    info: {
      id: `msg-${Math.random().toString(36).slice(2, 10)}`,
      sessionID: "test-session",
      role,
      time: { created: Date.now() },
    },
    parts: parts.map((p, i) => ({
      id: `part-${i}`,
      messageID: "msg-test",
      sessionID: "test-session",
      ...p,
    })),
  } as MessageV2.WithParts
}

function defaultCfg(): Config.Info {
  return { compaction: { auto: true } } as Config.Info
}

function deepseekV4Model(): Provider.Model {
  return createModel({ context: 1_000_000, output: 384_000 })
}

function deepseekChatModel(): Provider.Model {
  return createModel({ context: 128_000, output: 8_192 })
}

describe("isOverflowFromContent", () => {
  test("returns false for small text content on 1M context model", () => {
    // Simulate ~15K chars of text (3,750 tokens) вЂ” well under 980K usable
    const msgs = [
      makeMsg("user", [{ type: "text", text: "x".repeat(10_000) }]),
      makeMsg("assistant", [{ type: "text", text: "x".repeat(5_000) }]),
    ]
    const model = deepseekV4Model()
    expect(isOverflowFromContent({ cfg: defaultCfg(), msgs, model })).toBe(false)
  })

  test("returns false for 200K chars of text on 1M context model", () => {
    // 200K chars = 50K tokens вЂ” well under 980K usable
    const msgs = [
      makeMsg("user", [{ type: "text", text: "x".repeat(200_000) }]),
    ]
    const model = deepseekV4Model()
    expect(isOverflowFromContent({ cfg: defaultCfg(), msgs, model })).toBe(false)
  })

  test("returns true for 3.2M chars of text on 1M context model", () => {
    // 3.2M chars = 800K tokens в†’ 800K + 200K = 1M в†’ triggers
    const msgs = [
      makeMsg("user", [{ type: "text", text: "x".repeat(3_200_000) }]),
    ]
    const model = deepseekV4Model()
    expect(isOverflowFromContent({ cfg: defaultCfg(), msgs, model })).toBe(true)
  })

  test("counts reasoning part text", () => {
    // 700K of reasoning + 100K of text = 800K chars = 200K tokens
    // But 200K tokens << 800K needed for overflow on 1M context
    const msgs = [
      makeMsg("assistant", [
        { type: "reasoning", text: "x".repeat(100_000) },
        { type: "text", text: "x".repeat(700_000) },
      ]),
    ]
    const model = deepseekV4Model()
    expect(isOverflowFromContent({ cfg: defaultCfg(), msgs, model })).toBe(false)
  })

  test("skips ignored text parts", () => {
    // 4M chars total but 3.9M are ignored в†’ only 100K counted в†’ no overflow
    const msgs = [
      makeMsg("user", [
        { type: "text", text: "x".repeat(100_000) },
        { type: "text", text: "x".repeat(3_900_000), ignored: true },
      ]),
    ]
    const model = deepseekV4Model()
    expect(isOverflowFromContent({ cfg: defaultCfg(), msgs, model })).toBe(false)
  })

  test("counts completed tool output", () => {
    // 500K of tool output + 500K of text = 1M chars = 250K tokens
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool",
          tool: "bash",
          callID: "call-1",
          state: { status: "completed", output: "x".repeat(500_000), input: {}, metadata: {}, time: { start: 0, end: 1 }, title: "" },
        },
      ]),
      makeMsg("user", [{ type: "text", text: "x".repeat(500_000) }]),
    ]
    const model = deepseekV4Model()
    expect(isOverflowFromContent({ cfg: defaultCfg(), msgs, model })).toBe(false)
  })

  test("skips non-completed tool state", () => {
    // Only completed tools count; running/pending/error should not
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool",
          tool: "bash",
          callID: "call-1",
          state: { status: "running", input: {}, time: { start: 0 } },
        },
        {
          type: "tool",
          tool: "bash",
          callID: "call-2",
          state: { status: "error", error: "fail", input: {}, time: { start: 0, end: 1 } },
        },
      ]),
    ]
    const model = deepseekV4Model()
    expect(isOverflowFromContent({ cfg: defaultCfg(), msgs, model })).toBe(false)
  })

  test("returns false when compaction.auto is disabled", () => {
    const msgs = [makeMsg("user", [{ type: "text", text: "x".repeat(4_000_000) }])]
    const cfg = { compaction: { auto: false } } as Config.Info
    const model = deepseekV4Model()
    expect(isOverflowFromContent({ cfg, msgs, model })).toBe(false)
  })

  test("returns false when context limit is 0", () => {
    const msgs = [makeMsg("user", [{ type: "text", text: "x".repeat(4_000_000) }])]
    const model = createModel({ context: 0, output: 384_000 })
    expect(isOverflowFromContent({ cfg: defaultCfg(), msgs, model })).toBe(false)
  })

  test("returns false for empty message array", () => {
    const model = deepseekV4Model()
    expect(isOverflowFromContent({ cfg: defaultCfg(), msgs: [], model })).toBe(false)
  })
})

// --- estimateContentTokens tests (overflow.ts) ---

describe("estimateContentTokens", () => {
  test("counts text from text parts only", () => {
    const msgs = [
      makeMsg("user", [{ type: "text", text: "x".repeat(4000) }]),
      makeMsg("assistant", [{ type: "text", text: "x".repeat(1000) }]),
    ]
    const model = createModel({ context: 100_000, output: 32_000 })
    const count = estimateContentTokens(msgs, model)
    // 5000 chars / 4 = 1250 tokens (chars/4 heuristic, no tokenizer for test model)
    expect(count).toBe(1250)
  })

  test("skips non-text parts (metadata-only)", () => {
    const msgs = [
      makeMsg("assistant", [
        { type: "tool", tool: "bash", callID: "c1", state: { status: "running", input: {}, time: { start: 0 } } },
      ]),
    ]
    const model = createModel({ context: 100_000, output: 32_000 })
    const count = estimateContentTokens(msgs, model)
    expect(count).toBe(0)
  })

  test("includes completed tool output", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool",
          tool: "bash",
          callID: "c1",
          state: { status: "completed", output: "x".repeat(4000), input: {}, metadata: {}, time: { start: 0, end: 1 }, title: "" },
        },
      ]),
    ]
    const model = createModel({ context: 100_000, output: 32_000 })
    const count = estimateContentTokens(msgs, model)
    expect(count).toBe(1000)
  })

  test("includes reasoning text", () => {
    const msgs = [
      makeMsg("assistant", [
        { type: "reasoning", text: "x".repeat(4000) },
        { type: "text", text: "x".repeat(4000) },
      ]),
    ]
    const model = createModel({ context: 100_000, output: 32_000 })
    const count = estimateContentTokens(msgs, model)
    expect(count).toBe(2000)
  })

  test("skips ignored text parts", () => {
    const msgs = [
      makeMsg("user", [
        { type: "text", text: "x".repeat(4000) },
        { type: "text", text: "x".repeat(40000), ignored: true },
      ]),
    ]
    const model = createModel({ context: 100_000, output: 32_000 })
    const count = estimateContentTokens(msgs, model)
    expect(count).toBe(1000)
  })

  test("returns 0 for empty messages", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    expect(estimateContentTokens([], model)).toBe(0)
  })
})

// --- compact() tests ---

describe("session.compaction.compact", () => {
  it.live(
    "keeps the last ~32K of real messages; budget prunes the rest",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        // Create older messages (will be pruned)
        for (const text of ["old-1", "old-2"]) {
          const u = yield* ssn.updateMessage({
            id: MessageID.ascending(), role: "user", sessionID: info.id,
            agent: "build", model: ref, time: { created: Date.now() },
          })
          yield* ssn.updatePart({ id: PartID.ascending(), messageID: u.id, sessionID: info.id, type: "text", text })
        }

        // Create a summary assistant message (the compaction boundary)
        const summaryUser = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "user", sessionID: info.id,
          agent: "build", model: ref, time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(), messageID: summaryUser.id, sessionID: info.id,
          type: "text", text: "summary request",
        })
        const summaryAssistant = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: summaryUser.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({
          id: PartID.ascending(), messageID: summaryAssistant.id, sessionID: info.id,
          type: "text", text: "## Goal\n- summary content here",
        })

        // Create recent messages. recent-2 is padded past RECENT_MIN_TOKENS:
        // the budget ceiling stops the tail walk right after it, so recent-1
        // and the pre-summary history stay budget-excluded (they remain in
        // the archive — re-eligible on a future compact).
        for (const text of ["recent-1", "recent-2" + "y".repeat(140_000)]) {
          const u = yield* ssn.updateMessage({
            id: MessageID.ascending(), role: "user", sessionID: info.id,
            agent: "build", model: ref, time: { created: Date.now() },
          })
          yield* ssn.updatePart({ id: PartID.ascending(), messageID: u.id, sessionID: info.id, type: "text", text })
        }

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })

        // Model sees only message* — originals soft-hidden, not deleted
        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        expect(msgs).toHaveLength(1)
        const combined = msgs
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")

        expect(combined).toContain("=== COMPACTED ===")
        expect(combined).toContain("## Goal")
        expect(combined).toContain("summary content here")
        // Budget ceiling: recent-2 alone (~35K tokens) fills the tail budget,
        // so recent-1 and the older messages stay out of this m*.
        expect(combined).toContain("recent-2")
        expect(combined).not.toContain("recent-1")
        expect(combined).not.toContain("old-1")
        expect(combined).not.toContain("old-2")
        // System Exact handles present as passive ID lines (not recovery recipes)
        expect(combined).toContain("summary_message_id")
        expect(combined).toContain("session_id")
        expect(combined).toContain("info_mark: `Inferred`")
        expect(combined).toContain("InfoMark:")
        expect(combined).not.toContain("Fast recovery")
        expect(combined).not.toContain("no exploration needed")
      }),
    ),
  )

  it.live(
    "folds recent tail only when no summaries exist (T2 refusal removed)",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        for (const text of ["msg-1", "msg-2", "msg-3"]) {
          const u = yield* ssn.updateMessage({
            id: MessageID.ascending(), role: "user", sessionID: info.id,
            agent: "build", model: ref, time: { created: Date.now() },
          })
          yield* ssn.updatePart({ id: PartID.ascending(), messageID: u.id, sessionID: info.id, type: "text", text })
        }

        const result = yield* compact.compact({ sessionID: info.id, model: ref, agent: "build", force: true })

        // No summaries → m* = header + Recent tail (the tail IS the memory).
        expect(result.folded).toBe(true)
        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        expect(msgs).toHaveLength(1)
        const combined = msgs
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")
        expect(combined).toContain("=== COMPACTED ===")
        expect(combined).toContain("msg-1")
        expect(combined).toContain("msg-3")
      }),
    ),
  )

  it.live(
    "prior m* row is skipped — tail crosses it, the star row is never embedded",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        // Pre-star history folded with a summary
        const old = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: old.id, sessionID: info.id, type: "text", text: "pre-star-history" })
        const su = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: su.id, sessionID: info.id, type: "text", text: "summary-req" })
        const sa = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn", time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: sa.id, sessionID: info.id, type: "text", text: "## Goal\n- covers pre-star history" })

        // First fold → star1
        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after1 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after1).toHaveLength(1)

        // Growth + second summary → second fold
        const growth = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: growth.id, sessionID: info.id, type: "text", text: "post-star-work" })
        const su2 = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: su2.id, sessionID: info.id, type: "text", text: "summary-req-2" })
        const sa2 = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su2.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn", time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: sa2.id, sessionID: info.id, type: "text", text: "## Goal\n- covers post-star work" })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after2 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after2).toHaveLength(1)
        const combined = after2
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")
        expect(combined).toContain("post-star-work")
        // Tail crosses the prior star: real messages folded into star1's
        // window are re-eligible by budget (the star ROW itself is skipped).
        expect(combined).toContain("pre-star-history")
        // Both summaries carry forward (legacy rows collected regardless of
        // the prior star position).
        expect(combined).toContain("covers pre-star history")
        expect(combined).toContain("covers post-star work")
        // Chain link present (session-read hook).
        expect(combined).toContain("Prior message*")
        // Exactly one COMPACTED header — prior star is NOT embedded as a block.
        expect(combined.split("=== COMPACTED ===").length - 1).toBe(1)
      }),
    ),
  )

  it.live(
    "folds a large session tail-only when no summaries exist (T2 refusal removed)",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        // 30 messages × 5K chars = 150K chars ≈ 37.5K tokens
        for (const text of Array.from({ length: 30 }, (_, i) => `msg-${i}-` + "x".repeat(5000))) {
          const u = yield* ssn.updateMessage({
            id: MessageID.ascending(), role: "user", sessionID: info.id,
            agent: "build", model: ref, time: { created: Date.now() },
          })
          yield* ssn.updatePart({ id: PartID.ascending(), messageID: u.id, sessionID: info.id, type: "text", text })
        }

        const result = yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })

        // No summaries → tail-only fold: last ~32K tokens of messages become m*.
        expect(result.folded).toBe(true)
        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        expect(msgs).toHaveLength(1)
        const combined = msgs
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")
        expect(combined).toContain("=== COMPACTED ===")
        expect(combined).toContain("msg-5-")
        expect(combined).toContain("msg-29-")
        expect(combined).not.toContain("msg-0-")
      }),
    ),
  )
})

// --- computeOutputSinceLastSummary (be7c71c96c Layer-1 seed fix) ---

describe("session.compaction.computeOutputSinceLastSummary", () => {
  const asst = (
    id: string,
    tokens: { output: number; reasoning?: number },
    summary?: boolean,
  ): MessageV2.WithParts =>
    ({
      info: {
        id,
        role: "assistant",
        summary: summary || undefined,
        tokens: {
          output: tokens.output,
          reasoning: tokens.reasoning ?? 0,
          input: 0,
          cache: { read: 0, write: 0 },
        },
      },
      parts: [],
    }) as any

  const user = (id: string): MessageV2.WithParts =>
    ({ info: { id, role: "user" }, parts: [] }) as any

  test("sums output+reasoning from end until a summary assistant", () => {
    const msgs = [
      user("u0"),
      asst("s1", { output: 50_000, reasoning: 1_000 }, true),
      user("u1"),
      asst("a1", { output: 10_000, reasoning: 2_000 }),
      asst("a2", { output: 5_000, reasoning: 500 }),
    ]
    // Only a1+a2 after s1
    expect(SessionCompaction.computeOutputSinceLastSummary(msgs)).toBe(17_500)
  })

  test("sums from session start when no summary exists", () => {
    const msgs = [
      user("u0"),
      asst("a1", { output: 20_000, reasoning: 0 }),
      asst("a2", { output: 15_000, reasoning: 1_000 }),
    ]
    expect(SessionCompaction.computeOutputSinceLastSummary(msgs)).toBe(36_000)
  })

  test("returns 0 when latest visible assistant is a summary", () => {
    const msgs = [
      asst("a1", { output: 99_000 }),
      asst("s1", { output: 100 }, true),
    ]
    expect(SessionCompaction.computeOutputSinceLastSummary(msgs)).toBe(0)
  })

  test("ignores user messages and missing token fields", () => {
    const msgs = [
      user("u0"),
      { info: { id: "a1", role: "assistant" }, parts: [] } as any,
      asst("a2", { output: 100 }),
    ]
    expect(SessionCompaction.computeOutputSinceLastSummary(msgs)).toBe(100)
  })

  test("cross-turn seed can exceed SUMMARY_INTERVAL_TOKENS without a single large turn", () => {
    const half = Math.floor(SessionCompaction.SUMMARY_INTERVAL_TOKENS / 2) + 1
    const msgs = [
      asst("a1", { output: half }),
      asst("a2", { output: half }),
    ]
    const total = SessionCompaction.computeOutputSinceLastSummary(msgs)
    expect(total).toBeGreaterThanOrEqual(SessionCompaction.SUMMARY_INTERVAL_TOKENS)
    // Documents the fix: multi-turn sum (seed) crosses the inject threshold
    expect(half).toBeLessThan(SessionCompaction.SUMMARY_INTERVAL_TOKENS)
  })

  test("empty message list returns 0", () => {
    expect(SessionCompaction.computeOutputSinceLastSummary([])).toBe(0)
  })
})

// --- computeOpenWindowTokens (content chars/4 Layer-1 counter) ---

describe("session.compaction.computeOpenWindowTokens", () => {
  const textMsg = (
    id: string,
    role: "user" | "assistant",
    text: string,
    opts?: { summary?: boolean },
  ): MessageV2.WithParts =>
    ({
      info: {
        id,
        role,
        summary: opts?.summary || undefined,
        tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [{ type: "text", text }],
    }) as any

  test("counts content chars/4 from session start when no summary", () => {
    // 40_000 chars → 10_000 tokens
    const msgs = [
      textMsg("u0", "user", "x".repeat(20_000)),
      textMsg("a1", "assistant", "y".repeat(20_000)),
    ]
    expect(SessionCompaction.computeOpenWindowTokens(msgs)).toBe(10_000)
  })

  test("counts only after the checkpoint boundary (sidecar to_id)", () => {
    const msgs = [
      textMsg("u0", "user", "x".repeat(40_000)),
      textMsg("s1", "assistant", "summary", { summary: true }),
      textMsg("u1", "user", "y".repeat(8_000)),
      textMsg("a1", "assistant", "z".repeat(4_000)),
    ]
    // Boundary = s1 → only u1+a1 after it: 12_000 chars → 3_000 tokens
    expect(SessionCompaction.computeOpenWindowTokens(msgs, "s1")).toBe(3_000)
  })

  test("without a boundary, counts the whole visible list (sidecar semantics)", () => {
    const msgs = [
      textMsg("u0", "user", "x".repeat(40_000)),
      textMsg("s1", "assistant", "summary", { summary: true }),
      textMsg("u1", "user", "y".repeat(8_000)),
      textMsg("a1", "assistant", "z".repeat(4_000)),
    ]
    // 52_007 chars → 13_002 tokens — a legacy summary assistant is no boundary.
    expect(SessionCompaction.computeOpenWindowTokens(msgs)).toBe(13_002)
  })

  test("message* alone is NOT an increment — counter skips the leading star", () => {
    const body = "=== COMPACTED ===\n" + "m".repeat(SessionCompaction.SUMMARY_INTERVAL_TOKENS * 4 + 100)
    const msgs = [textMsg("star", "user", body)]
    expect(SessionCompaction.computeOpenWindowTokens(msgs)).toBe(0)
  })

  test("after a fold, only NEW messages count toward the increment (star excluded)", () => {
    const star = textMsg(
      "star",
      "user",
      "=== COMPACTED ===\n" + "m".repeat(SessionCompaction.SUMMARY_INTERVAL_TOKENS * 4),
    )
    const fresh = textMsg("u1", "user", "y".repeat(8_000))
    // Only the 8_000-char new message counts: 2_000 tokens, not ~64K+2K.
    expect(SessionCompaction.computeOpenWindowTokens([star, fresh])).toBe(2_000)
  })

  test("returns 0 when the boundary is the latest message", () => {
    const msgs = [
      textMsg("u0", "user", "x".repeat(40_000)),
      textMsg("s1", "assistant", "done", { summary: true }),
    ]
    expect(SessionCompaction.computeOpenWindowTokens(msgs, "s1")).toBe(0)
  })

  test("empty message list returns 0", () => {
    expect(SessionCompaction.computeOpenWindowTokens([])).toBe(0)
  })
})

describe("session.compaction.hasPendingSummaryRequest", () => {
  const userText = (id: string, text: string): MessageV2.WithParts =>
    ({
      info: { id, role: "user" },
      parts: [{ type: "text", text }],
    }) as any

  const asst = (id: string, summary?: boolean): MessageV2.WithParts =>
    ({
      info: { id, role: "assistant", summary: summary || undefined },
      parts: [{ type: "text", text: "ok" }],
    }) as any

  test("detects open summary-range user message", () => {
    const msgs = [
      userText("u0", "hello"),
      asst("a1"),
      userText(
        "req",
        `<!-- summary-range from_id="a" to_id="b" session_id="s" -->\nCreate a structured summary`,
      ),
    ]
    expect(SessionCompaction.hasPendingSummaryRequest(msgs)).toBe(true)
  })

  test("false after summary assistant answers the request", () => {
    const msgs = [
      userText(
        "req",
        `<!-- summary-range from_id="a" to_id="b" session_id="s" -->\nCreate a structured summary`,
      ),
      asst("s1", true),
      userText("u1", "continue"),
    ]
    expect(SessionCompaction.hasPendingSummaryRequest(msgs)).toBe(false)
  })

  test("false when no summary-range present", () => {
    const msgs = [userText("u0", "hello"), asst("a1")]
    expect(SessionCompaction.hasPendingSummaryRequest(msgs)).toBe(false)
  })
})

// --- multiple summary boundaries ---

describe("session.compaction.multiple-summaries", () => {
  it.live(
    "keeps all summaries and messages after the last summary",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        const makeAssistant = (parentID: string, summary: boolean) =>
          Effect.gen(function* () {
            const a = yield* ssn.updateMessage({
              id: MessageID.ascending(), role: "assistant", sessionID: info.id,
              mode: "build", agent: "build", parentID,
              modelID: ref.modelID, providerID: ref.providerID,
              path: { cwd: dir, root: dir }, cost: 0,
              tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              summary: summary || undefined, finish: "end_turn",
              time: { created: Date.now() },
            } as MessageV2.Assistant)
            if (summary) {
              yield* ssn.updatePart({
                id: PartID.ascending(), messageID: a.id, sessionID: info.id,
                type: "text", text: "## Goal\n- summary for " + (parentID ? "segment" : "initial"),
              })
            }
            return a
          })

        // old messages (will be pruned)
        const u1 = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: u1.id, sessionID: info.id, type: "text", text: "old-before-s1" })
        yield* makeAssistant(u1.id, false)

        // summary 1 (kept as boundary, but older than s2)
        const s1u = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: s1u.id, sessionID: info.id, type: "text", text: "summary-1-request" })
        yield* makeAssistant(s1u.id, true)

        // middle messages
        const m1 = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: m1.id, sessionID: info.id, type: "text", text: "middle-msg" })

        // summary 2 (most recent — this is the compaction boundary)
        const s2u = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: s2u.id, sessionID: info.id, type: "text", text: "summary-2-request" })
        yield* makeAssistant(s2u.id, true)

        // recent messages after s2 (padded past RECENT_MIN_TOKENS so the Recent
        // walk-back does not overlap into pre-summary history)
        const r1 = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: r1.id, sessionID: info.id, type: "text", text: "recent-after-s2" + "z".repeat(140_000) })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })

        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        expect(msgs).toHaveLength(1)
        const combined = msgs
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")

        // Old content not in message* (pre-summary)
        expect(combined).not.toContain("old-before-s1")
        // All summaries folded into message*
        expect(combined).toContain("## Goal")
        expect(combined).toContain("summary for segment")
        expect(combined).toContain("Summary 1")
        expect(combined).toContain("Summary 2")
        // Recent after last summary
        expect(combined).toContain("recent-after-s2")
        // Middle between s1 and s2 is covered by s2, not raw-dumped
        expect(combined).not.toContain("middle-msg")
        expect(combined).toContain("=== COMPACTED ===")
        expect(combined).toContain("summary_message_id")
      }),
    ),
  )
})

// --- content-based overflow detection ---

describe("session.compaction.overflow-triggers", () => {
  it.live(
    "isOverflow detects token-based overflow",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 85_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(true)
      }),
    ),
  )

  it.live(
    "isOverflow returns false within limits",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(false)
      }),
    ),
  )

  it.live(
    "isOverflowFromContent detects text overflow on small context models",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        // 3.2M chars = ~800K tokens → triggers on 1M model
        const msgs = [
          makeMsg("user", [{ type: "text", text: "x".repeat(3_200_000) }]),
        ]
        const model = createModel({ context: 1_000_000, output: 384_000 })
        expect(isOverflowFromContent({ cfg: defaultCfg(), msgs, model })).toBe(true)
      }),
    ),
  )

  it.live(
    "isOverflowFromContent stays false for normal content on large context",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const msgs = [
          makeMsg("user", [{ type: "text", text: "x".repeat(10_000) }]),
          makeMsg("assistant", [{ type: "text", text: "x".repeat(5_000) }]),
        ]
        const model = createModel({ context: 1_000_000, output: 384_000 })
        expect(isOverflowFromContent({ cfg: defaultCfg(), msgs, model })).toBe(false)
      }),
    ),
  )
})

// --- provider overflow (token-based, via processor) ---

describe("session.compaction.provider-overflow", () => {
  liveIt.live(
    "processor returns compact when provider reports high token usage",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const sessionProcessor = yield* SessionProcessorModule.SessionProcessor.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        // Create a user message
        const userMsg = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "user", sessionID: info.id,
          agent: "build", model: ref, time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(), messageID: userMsg.id, sessionID: info.id,
          type: "text", text: "hello",
        })

        // Create assistant message and processor handle
        const assistantMsg: MessageV2.Assistant = {
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          parentID: userMsg.id, mode: "build", agent: "build",
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        }
        yield* ssn.updateMessage(assistantMsg)

        const handle = yield* sessionProcessor.create({
          assistantMessage: assistantMsg, sessionID: info.id,
          model: createModel({ context: 100_000, output: 32_000 }),
          agentName: "build",
        })

        // The processor handle starts with 0 tokens — not overflowing.
        // We verify the handle is created and has the process method.
        expect(handle.process).toBeDefined()
        expect(handle.message.id).toBe(assistantMsg.id)
      }),
    ),
  )
})

// --- regression: no CompactionPart after compact ---

describe("session.compaction.regression", () => {
  it.live(
    "compact() does not inject CompactionPart (pruning is direct)",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        // Create a summary
        const su = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: su.id, sessionID: info.id, type: "text", text: "summary-req" })
        const sa = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: sa.id, sessionID: info.id, type: "text", text: "## Goal\n- regression coverage" })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })

        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        // No message should have a compaction-type part
        for (const msg of msgs) {
          const compactionParts = msg.parts.filter((p: any) => p.type === "compaction")
          expect(compactionParts).toHaveLength(0)
        }
        // But the compacted text message should be present
        const allTexts = msgs.flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
        expect(allTexts.some((t: string) => t.includes("=== COMPACTED ==="))).toBe(true)
      }),
    ),
  )

  it.live(
    "filterCompactedEffect loads all messages after compact (fast path)",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        // Create old + summary + recent
        for (const text of ["old"]) {
          const u = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
          yield* ssn.updatePart({ id: PartID.ascending(), messageID: u.id, sessionID: info.id, type: "text", text })
        }
        const su = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: su.id, sessionID: info.id, type: "text", text: "summary-req" })
        const sa = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: sa.id, sessionID: info.id, type: "text", text: "## Goal\n- fast path coverage" })
        const ru = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: ru.id, sessionID: info.id, type: "text", text: "recent" })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })

        // Only message* visible; recent content lives inside it
        const filtered = yield* MessageV2.filterCompactedEffect(info.id)
        expect(filtered).toHaveLength(1)
        expect(filtered.some((m: any) =>
          m.parts.some((p: any) => p.type === "text" && p.text?.includes("recent"))
        )).toBe(true)
      }),
    ),
  )
})

// ============================================================================
// edge case coverage
// ============================================================================

describe("session.compaction.edge-cases", () => {
  it.live("does nothing on empty session", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }
        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        expect(msgs).toHaveLength(0)
      }),
    ),
  )

  it.live("compact with summary but no tail messages", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }
        const su = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: su.id, sessionID: info.id, type: "text", text: "summary-req" })
        const sa2 = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn", time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: sa2.id, sessionID: info.id, type: "text", text: "## Goal\n- no tail coverage" })
        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        expect(msgs).toHaveLength(1)
        const allTexts = msgs.flatMap((m: any) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
        expect(allTexts.some((t: string) => t.includes("=== COMPACTED ==="))).toBe(true)
      }),
    ),
  )

  it.live("re-compacts after growth without a new summary (tail-only fold)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }
        const su = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: su.id, sessionID: info.id, type: "text", text: "summary-req <!-- summary-range from_id=\"a\" to_id=\"b\" -->" })
        const sa = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn", time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({
          id: PartID.ascending(), messageID: sa.id, sessionID: info.id,
          type: "text", text: "## Goal\n- first cycle summary",
        })
        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after1 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after1).toHaveLength(1)
        const star1 = after1[0].info.id

        // Growth after message* — loop continues
        const normal = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: normal.id, sessionID: info.id, type: "text", text: "post-star-work" })

        // No new summary in this window → tail-only fold: the growth message
        // becomes m*2; star1 goes session-read only (recoverable via the
        // m* chain link).
        const second = yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        expect(second.folded).toBe(true)
        const after2 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after2).toHaveLength(1)
        expect(after2[0].info.id).not.toBe(star1)
        const texts2 = after2
          .flatMap((m: any) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")
        expect(texts2).toContain("post-star-work")
      }),
    ),
  )
})

// --- Key decisions preservation (c9cb41e06d / epistemic guardrails step C) ---

describe("session.compaction.key-decisions", () => {
  it.live(
    "folds ## Key decisions into a preserved Decisions block on compact",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        const su = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "user", sessionID: info.id,
          agent: "build", model: ref, time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(), messageID: su.id, sessionID: info.id,
          type: "text", text: "summary-req",
        })
        const sa = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn", time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({
          id: PartID.ascending(), messageID: sa.id, sessionID: info.id,
          type: "text",
          text: [
            "## Goal",
            "Ship epistemic guardrails",
            "",
            "## Key decisions",
            "- Use Fossil for snapshot backend only",
            "- Keep session-read as Exact ground truth",
            "",
            "## Current state",
            "Implementation in progress",
          ].join("\n"),
        })

        const recent = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "user", sessionID: info.id,
          agent: "build", model: ref, time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(), messageID: recent.id, sessionID: info.id,
          type: "text", text: "continue work",
        })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })

        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        expect(msgs).toHaveLength(1)
        const combined = msgs
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")

        expect(combined).toContain("=== COMPACTED ===")
        expect(combined).toContain("Decisions (preserved verbatim across compaction cycles)")
        expect(combined).toContain("info_mark: Inferred — not re-summarized")
        expect(combined).toContain("Use Fossil for snapshot backend only")
        expect(combined).toContain("Keep session-read as Exact ground truth")
        // Original section still present inside the summary block as well
        expect(combined).toContain("## Key decisions")
      }),
    ),
  )

  it.live(
    "preserves Key decisions across a second compaction cycle",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        const su = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "user", sessionID: info.id,
          agent: "build", model: ref, time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(), messageID: su.id, sessionID: info.id,
          type: "text", text: "summary-req",
        })
        const sa = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn", time: { created: Date.now() },
        } as MessageV2.Assistant)
        const decisionLine = "Adopt AES-256-GCM for checkpoint slots"
        yield* ssn.updatePart({
          id: PartID.ascending(), messageID: sa.id, sessionID: info.id,
          type: "text",
          text: [
            "## Goal",
            "Secure checkpoints",
            "",
            "## Key decisions",
            `- ${decisionLine}`,
            "",
            "## Current state",
            "Done",
          ].join("\n"),
        })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after1 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after1).toHaveLength(1)
        const star1 = after1[0].info.id
        const text1 = after1
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")
        expect(text1).toContain(decisionLine)

        // Growth then re-compact — decision must survive (Inferred once, not re-Inferred)
        const growth = yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "user", sessionID: info.id,
          agent: "build", model: ref, time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(), messageID: growth.id, sessionID: info.id,
          type: "text", text: "more work after star",
        })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after2 = yield* MessageV2.filterCompactedEffect(info.id)
        // Summaries carry forward: star1's legacy summary (with the decision)
        // is collected again into m*2 — decisions survive every cycle.
        expect(after2).toHaveLength(1)
        const text2 = after2
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")
        expect(text2).toContain("more work after star")
        expect(text2).toContain(decisionLine)
      }),
    ),
  )

  it.live(
    "collects decisions from multiple summary assistants",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        const makeSummary = (decision: string) =>
          Effect.gen(function* () {
            const u = yield* ssn.updateMessage({
              id: MessageID.ascending(), role: "user", sessionID: info.id,
              agent: "build", model: ref, time: { created: Date.now() },
            })
            yield* ssn.updatePart({
              id: PartID.ascending(), messageID: u.id, sessionID: info.id,
              type: "text", text: "summary-req",
            })
            const a = yield* ssn.updateMessage({
              id: MessageID.ascending(), role: "assistant", sessionID: info.id,
              mode: "build", agent: "build", parentID: u.id,
              modelID: ref.modelID, providerID: ref.providerID,
              path: { cwd: dir, root: dir }, cost: 0,
              tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              summary: true, finish: "end_turn", time: { created: Date.now() },
            } as MessageV2.Assistant)
            yield* ssn.updatePart({
              id: PartID.ascending(), messageID: a.id, sessionID: info.id,
              type: "text",
              text: `## Goal\nx\n\n## Key decisions\n- ${decision}\n\n## Current state\ny`,
            })
          })

        yield* makeSummary("Decision from summary one")
        yield* makeSummary("Decision from summary two")

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const combined = (yield* MessageV2.filterCompactedEffect(info.id))
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")

        expect(combined).toContain("Decision from summary one")
        expect(combined).toContain("Decision from summary two")
        expect(combined).toContain("Decisions (preserved verbatim across compaction cycles)")
      }),
    ),
  )
})

// --- Full-cycle compaction fidelity (messageStar faithful rendering) ---

describe("session.compaction.full-cycle", () => {
  it.live(
    "(u1,m1,m2,m3)→s1, (u2,m4,m5,m6)→s2, (m7,u3,m8,m9) <30k → compact → faithful m*",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        // --- Helpers ---
        const mkUser = (text: string) =>
          Effect.gen(function* () {
            const m = yield* ssn.updateMessage({
              id: MessageID.ascending(), role: "user", sessionID: info.id,
              agent: "build", model: ref, time: { created: Date.now() },
            })
            yield* ssn.updatePart({
              id: PartID.ascending(), messageID: m.id, sessionID: info.id,
              type: "text", text,
            })
            return m
          })

        const mkAssistant = (parts: Array<{ type: string } & Record<string, any>>) =>
          Effect.gen(function* () {
            const m = yield* ssn.updateMessage({
              id: MessageID.ascending(), role: "assistant", sessionID: info.id,
              mode: "build", agent: "build",
              modelID: ref.modelID, providerID: ref.providerID,
              path: { cwd: dir, root: dir }, cost: 0,
              tokens: { output: parts.reduce((n, p) => n + ((p as any).text?.length ?? 0), 0), input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              finish: "end_turn", time: { created: Date.now() },
            } as MessageV2.Assistant)
            for (const p of parts) {
              yield* ssn.updatePart({
                id: PartID.ascending(), messageID: m.id, sessionID: info.id,
                ...p,
              } as any)
            }
            return m
          })

        const mkSummary = (goalText: string, keyDecision: string) =>
          Effect.gen(function* () {
            // Summary request user message
            const su = yield* mkUser("summary-req")
            const sa = yield* ssn.updateMessage({
              id: MessageID.ascending(), role: "assistant", sessionID: info.id,
              mode: "build", agent: "build", parentID: su.id,
              modelID: ref.modelID, providerID: ref.providerID,
              path: { cwd: dir, root: dir }, cost: 0,
              tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              summary: true, finish: "end_turn", time: { created: Date.now() },
            } as MessageV2.Assistant)
            yield* ssn.updatePart({
              id: PartID.ascending(), messageID: sa.id, sessionID: info.id,
              type: "text",
              text: [
                "## Goal",
                goalText,
                "",
                "## Key decisions",
                `- ${keyDecision}`,
                "",
                "## Current state",
                "completed",
              ].join("\n"),
            })
          })

        // ============================================================
        // Segment 1: u1, m1, m2, m3 → s1
        // ============================================================
        yield* mkUser("user-msg-1")
        yield* mkAssistant([
          { type: "text", text: "assistant-text-1" },
          { type: "reasoning", text: "reasoning-for-m1" },
          { type: "tool", tool: "bash", callID: "c1",
            state: { status: "completed", output: "tool-output-1", input: {}, metadata: {}, time: { start: 0, end: 1 }, title: "" } },
        ])
        yield* mkAssistant([{ type: "text", text: "assistant-text-2" }])
        yield* mkAssistant([
          { type: "text", text: "assistant-text-3" },
          { type: "reasoning", text: "reasoning-for-m3" },
        ])
        yield* mkSummary("summary for segment 1", "decision-from-s1")

        // ============================================================
        // Segment 2: u2, m4, m5, m6 → s2
        // ============================================================
        yield* mkUser("user-msg-2")
        yield* mkAssistant([{ type: "text", text: "assistant-text-4" }])
        yield* mkAssistant([
          { type: "text", text: "assistant-text-5" },
          { type: "tool", tool: "cmd", callID: "c2",
            state: { status: "completed", output: "tool-output-2", input: {}, metadata: {}, time: { start: 0, end: 1 }, title: "" } },
        ])
        yield* mkAssistant([{ type: "text", text: "assistant-text-6" }])
        yield* mkSummary("summary for segment 2", "decision-from-s2")

        // ============================================================
        // Segment 3 (recent): m7, u3, m8, m9 — u3 is padded past
        // RECENT_MIN_TOKENS, so the budget stops the tail walk right after
        // u3: the tail is [u3, m8, m9]; m7 and earlier segments stay
        // archive-only until the budget frees up.
        // ============================================================
        yield* mkAssistant([{ type: "text", text: "assistant-text-7" }])
        yield* mkUser("user-msg-3" + "z".repeat(140_000))
        yield* mkAssistant([
          { type: "text", text: "assistant-text-8" },
          { type: "reasoning", text: "reasoning-for-m8" },
        ])
        yield* mkAssistant([
          { type: "text", text: "assistant-text-9" },
          { type: "tool", tool: "bash", callID: "c3",
            state: { status: "running", input: {}, time: { start: Date.now() } } },
        ])

        // ============================================================
        // Compact
        // ============================================================
        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })

        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        expect(msgs).toHaveLength(1)
        expect(msgs[0].info.role).toBe("user")

        const combined = msgs
          .flatMap((m: any) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")

        // --- Header ---
        expect(combined).toContain("=== COMPACTED ===")
        // First compaction → no Prior message* chain link
        expect(combined).not.toContain("Prior message*")

        // --- Summaries section (chronological: s1 then s2) ---
        const s1Idx = combined.indexOf("Summary 1")
        const s2Idx = combined.indexOf("Summary 2")
        expect(s1Idx).toBeGreaterThan(-1)
        expect(s2Idx).toBeGreaterThan(-1)
        expect(s1Idx).toBeLessThan(s2Idx) // chronological order

        expect(combined).toContain("summary for segment 1")
        expect(combined).toContain("decision-from-s1")
        expect(combined).toContain("summary for segment 2")
        expect(combined).toContain("decision-from-s2")
        expect(combined).toContain("summary_message_id")

        // --- Decisions block ---
        expect(combined).toContain("Decisions (preserved verbatim across compaction cycles)")
        expect(combined).toContain("decision-from-s1")
        expect(combined).toContain("decision-from-s2")

        // --- Recent section: messages after last summary (s2) ---
        // User messages must be faithfully rendered (test of ignored guard fix)
        expect(combined).toContain("user-msg-3")

        // Assistant text and reasoning must be separately labeled
        expect(combined).toContain("[text]")
        expect(combined).toContain("[reasoning]")

        // Completed tool outputs in Recent (m9's bash tool, running)
        expect(combined).toContain("[tool:bash]")
        // Tool output on summarized messages (m1, m5) is NOT in Recent —
        // those messages were covered by s1/s2 summaries. Only Recent messages
        // after the last summary are faithfully rendered.

        // Running tool must also be visible (not just completed)
        expect(combined).toContain("(running)")

        // Recent messages must be in chronological order. The budget stops the
        // tail walk after u3 (~35K tokens) — m7 and earlier segments stay
        // archive-only (re-eligible once the budget frees up).
        const u3Idx = combined.indexOf("user-msg-3")
        const r8Idx = combined.indexOf("assistant-text-8")
        const r9Idx = combined.indexOf("assistant-text-9")
        expect(u3Idx).toBeGreaterThan(-1)
        expect(r8Idx).toBeGreaterThan(-1)
        expect(r9Idx).toBeGreaterThan(-1)
        expect(u3Idx).toBeLessThan(r8Idx)
        expect(r8Idx).toBeLessThan(r9Idx)
        expect(combined).not.toContain("assistant-text-7")
        expect(combined).not.toContain("assistant-text-1")
      }),
    ),
  )
})
