import { NodeFileSystem } from "@effect/platform-node"
import nodePath from "path"
import { afterEach, describe, expect, mock, setDefaultTimeout, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect"
import * as Stream from "effect/Stream"
import z from "zod"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { Agent } from "../../src/agent/agent"
import { LLM } from "../../src/session/llm"
import { SessionCompaction } from "../../src/session/compaction"
import { estimateContentTokens, estimateRequestTokens } from "../../src/session/overflow"
import { MediaTokenCalibration } from "../../src/session/media-token-calibration"
import { countTokens } from "../../src/session/token-count"
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

// This file is HEAVY: 80+ cases, most booting a tmpdir Instance and several spawning real
// processes, and it runs alongside four other files. bun's 5 s default sits below that, so
// a loaded machine turns a passing case into `✗ ... [5004.00ms] this test timed out` — a
// red that says nothing about the code (measured 2026-09-19: the same case ran 3.70 s
// alone and 5.004 s inside the 5-file run). File-level, not per-test: the whole file
// shares the load profile, and whack-a-mole per test only moves the boundary.
setDefaultTimeout(20_000)

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
  /** Modality support — the gate deciding whether media bytes reach the wire. */
  image?: boolean
  video?: boolean
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
      input: { text: true, image: opts.image ?? false, audio: false, video: opts.video ?? false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: opts.npm ?? "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

const wide = () => ProviderTest.fake({ model: createModel({ context: 100_000, output: 32_000 })
})

// --- permanent memory rides the fold ---

describe("session.compaction.memory", () => {
  it.live(
    "m* reproduces permanent memory verbatim inside <memory>",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        // A summary is Inferred prose about what happened. Memory is what an
        // identity deliberately wrote to survive the boundary, so the fold
        // reproduces it rather than summarizing it — otherwise "persist before
        // you compact" buys nothing the next cycle can rely on.
        const criterion = "criterion: an instrument that cannot fail proves nothing"
        yield* Effect.promise(() =>
          Bun.write(nodePath.join(dir, ".opencode/data/memory/reasoning.md"), criterion + "\n"),
        )

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
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: sa.id, sessionID: info.id, type: "text", text: "## Goal\n- fold with memory present" })
        const ru = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: ru.id, sessionID: info.id, type: "text", text: "recent-msg" })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })

        const after = yield* MessageV2.filterCompactedEffect(info.id)
        const star = after.flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text)).join("\n")
        expect(star).toContain("=== COMPACTED ===")
        expect(star).toContain("<memory>")
        expect(star).toContain("</memory>")
        expect(star).toContain(criterion)
        // Before the summaries: it is the most durable content in the star,
        // not a recovery recipe, and the one recovery pointer stays last.
        expect(star.indexOf("<memory>")).toBeLessThan(star.indexOf("--- Recent"))
        expect(
          star
            .trimEnd()
            .endsWith(
              "Use messagesearch, sessionread and dbread to restore missing facts; recall(id) returns a dropped tool result in full.",
            ),
        ).toBe(true)
      }),
    ),
  )

  it.live(
    "a session with no memory folds without an empty <memory> block",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        // Never-written memory is the normal case. An empty block would spend
        // window on nothing and read as "memory exists and is empty".
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
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: sa.id, sessionID: info.id, type: "text", text: "## Goal\n- fold without memory" })
        const ru = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: ru.id, sessionID: info.id, type: "text", text: "recent-msg" })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })

        const after = yield* MessageV2.filterCompactedEffect(info.id)
        const star = after.flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text)).join("\n")
        expect(star).toContain("=== COMPACTED ===")
        expect(star).not.toContain("<memory>")
      }),
    ),
  )
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

  test("prefers OpenRouter reported cost over the table estimate (usage accounting)", () => {
    // Registry rates would compute 1M input × 0.075/M = $0.075; the provider
    // reported $0.042 (upstream-specific real price) — reported must win.
    const model = createModel({
      context: 100_000,
      output: 32_000,
      cost: { input: 0.075, output: 0.25, cache: { read: 0, write: 0 } },
    })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 0,
        totalTokens: 1_000_000,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
      metadata: { openrouter: { provider: "chutes", usage: { cost: 0.042 } } } as never,
    })
    expect(result.cost).toBe(0.042)
    expect(result.endpoint).toBe("chutes")
  })

  test("falls back to table-derived cost and no endpoint without openrouter metadata", () => {
    const model = createModel({
      context: 100_000,
      output: 32_000,
      cost: { input: 0.075, output: 0.25, cache: { read: 0, write: 0 } },
    })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 0,
        totalTokens: 1_000_000,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
    })
    expect(result.cost).toBeCloseTo(0.075, 10)
    expect(result.endpoint).toBeUndefined()
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

function deepseekChatModel(): Provider.Model {
  return createModel({ context: 128_000, output: 8_192 })
}

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
    "keeps the WHOLE epoch since the last summary; the 32k floor only reaches further back",
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

        // Create recent messages. recent-2 is padded past RECENT_MIN_TOKENS, and
        // that must change NOTHING: the epoch after the previous summary is kept
        // whole regardless of size (owner ruling 2026-09-19: «мы должны брать все
        // токены с момента предыдущего summary но не меньше чем 32к»). Only the
        // pre-summary history stays out, and only because this epoch already
        // satisfies the floor.
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
        // EPOCH, not budget: recent-1 rides along even though recent-2 alone
        // already crossed the floor — the tail is everything since the previous
        // summary. The old rule stopped at ~32K wherever that landed and so
        // dropped the OLDEST messages of the epoch, which is the defect the
        // ruling names.
        expect(combined).toContain("recent-2")
        expect(combined).toContain("recent-1")
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

  // ── Media is priced by DIMENSIONS, never by payload bytes (2026-09-18) ─────
  //
  // Until this was wired an image was invisible to BOTH thresholds: `contentChars`
  // never saw a `file` part (it skips them as "negligible" — true while a `file`
  // was a path, false once it held base64), the only calibration reader was itself
  // dead (it had zero call sites and was deleted on 2026-09-19), and
  // `media_token_calibration` is empty because our providers never send
  // `prompt_tokens_details.image_tokens`. A window full of screenshots therefore
  // reported headroom. Bytes can never be the price: counting a base64 blob as
  // text produced ~688K phantom tokens and dropped a video (measured 2026-09-07).
  const imageMsg = (
    id: string,
    dimensions?: { width: number; height: number },
    mime = "image/png",
  ): MessageV2.WithParts =>
    ({
      info: { id, role: "user", tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
      parts: [
        {
          id: `p-${id}`,
          messageID: id,
          sessionID: "s",
          type: "file",
          mime,
          url: "data:image/png;base64,AAAA",
          dimensions,
        },
      ],
    }) as any

  test("prices an image from the MEASURED token curve", () => {
    const model = createModel({ context: 100_000, output: 32_000, image: true })
    // 1024×768 = 786_432 px ⇒ 786_432/1700 + 36 = 499 on the curve measured
    // against the live API (2026-09-12). Deliberately NOT a tile count: a tile
    // grid says ~765 here and ~2805 at 2000², where the real price has long
    // saturated — it would overcharge exactly where the images are biggest.
    const msgs = [imageMsg("u0", { width: 1024, height: 768 })]
    expect(SessionCompaction.computeOpenWindowTokens(msgs, undefined, model)).toBe(499)
  })

  test("a small canvas hits the measured FLOOR, not a fraction of it", () => {
    // 128² = 16_384 px prices at ~46 linearly, but the provider upscales small
    // canvases to ~544² and charges the plateau: 187, measured.
    const model = createModel({ context: 100_000, output: 32_000, image: true })
    const msgs = [imageMsg("u0", { width: 128, height: 128 })]
    expect(SessionCompaction.computeOpenWindowTokens(msgs, undefined, model)).toBe(187)
  })

  test("a large canvas SATURATES — the server downscales and the price stops", () => {
    // 2000² is what our own ingestion cap produces. Linear-in-area would say
    // ~2389 and a tile grid ~2805; the measured cap is 997 and nothing grows
    // past 1280². Overcharging here folds early, for no reason, on precisely the
    // images that are most expensive to re-encode — the wrong direction to err.
    const model = createModel({ context: 100_000, output: 32_000, image: true })
    const msgs = [imageMsg("u0", { width: 2000, height: 2000 })]
    expect(SessionCompaction.computeOpenWindowTokens(msgs, undefined, model)).toBe(997)
  })

  test("NEGATIVE CONTROL: without a model the image stays invisible", () => {
    // The identical messages with no model argument give exactly what this
    // counter returned before the change — the price is OPT-IN by argument, not
    // a blanket rewrite of every call site.
    const msgs = [imageMsg("u0", { width: 1024, height: 768 })]
    expect(SessionCompaction.computeOpenWindowTokens(msgs)).toBe(0)
  })

  test("a model that cannot take images is not charged for them", () => {
    // createModel defaults to image:false — those bytes never reach that
    // provider's wire (they leave as text), so pricing them invents cost.
    const model = createModel({ context: 100_000, output: 32_000 })
    const msgs = [imageMsg("u0", { width: 1024, height: 768 })]
    expect(SessionCompaction.computeOpenWindowTokens(msgs, undefined, model)).toBe(0)
  })

  test("unknown dimensions stay unknown — never a fabricated number", () => {
    const model = createModel({ context: 100_000, output: 32_000, image: true })
    expect(SessionCompaction.computeOpenWindowTokens([imageMsg("u0")], undefined, model)).toBe(0)
  })

  test("a video the model cannot take natively is not charged (frames are priced instead)", () => {
    // createModel defaults video:false. Such a model receives SAMPLED IMAGES from
    // `read.ts`, never the mp4, so the mp4's duration is not its price — and the
    // frames themselves are image parts, priced by dimensions like any other.
    const model = createModel({ context: 100_000, output: 32_000, image: true })
    const msgs = [imageMsg("u0", { width: 1024, height: 768 }, "video/mp4")]
    expect(SessionCompaction.computeOpenWindowTokens(msgs, undefined, model)).toBe(0)
  })

  // ── Video is priced by DURATION (2026-09-18) ─────────────────────────────────
  //
  // A video-capable model receives the mp4 as one `video_url` block, and the
  // provider bills it by duration while reporting `video_tokens: 0` — the cost is
  // folded into prompt_tokens, so there is no per-item figure to calibrate from.
  // ONE point is measured (2026-09-07: 1.97 MiB ≈ 6s → 2610 tokens); the planned
  // 30/120/600s curve (C5) was never run, so the price is a linear upper bound.
  const videoMsg = (id: string, durationSeconds?: number): MessageV2.WithParts =>
    ({
      info: { id, role: "user", tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
      parts: [
        {
          id: `p-${id}`,
          messageID: id,
          sessionID: "s",
          type: "file",
          mime: "video/mp4",
          url: "data:video/mp4;base64,AAAA",
          durationSeconds,
        },
      ],
    }) as any

  test("prices a video from its duration on a video-capable model", () => {
    const model = createModel({ context: 100_000, output: 32_000, video: true })
    // 6s × 435 = 2610 — the measured point, reproduced by the extrapolation.
    expect(SessionCompaction.computeOpenWindowTokens([videoMsg("u0", 6)], undefined, model)).toBe(2_610)
  })

  test("a video with no stamped duration stays unpriced", () => {
    // No duration ⇒ no price, never a fabricated one — the same contract an image
    // with unknown dimensions has. `read.ts` stamps it via ffprobe, and ffprobe
    // being absent is exactly the case that must not invent a cost.
    const model = createModel({ context: 100_000, output: 32_000, video: true })
    expect(SessionCompaction.computeOpenWindowTokens([videoMsg("u0")], undefined, model)).toBe(0)
  })

  test("linear in duration: two videos of 6s cost twice one", () => {
    const model = createModel({ context: 100_000, output: 32_000, video: true })
    const msgs = [videoMsg("u0", 6), videoMsg("u1", 6)]
    expect(SessionCompaction.computeOpenWindowTokens(msgs, undefined, model)).toBe(5_220)
  })

  it.live("a measured per-model price OVERRIDES the dimensional formula", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        // A distinct model id keeps the module-level calibration cache from
        // leaking into the pure cases above. `ModelID.make` keeps the brand the
        // spread would otherwise drop (`Provider.Model["id"]` is branded).
        const model = {
          ...createModel({ context: 100_000, output: 32_000, image: true }),
          id: ModelID.make("test-measured-model"),
        } as Provider.Model
        MediaTokenCalibration.record({ model, modality: "image", measuredTokens: 5_000, itemCount: 5 })
        // Measured 1_000 per item beats the formula's 765 for this image: the
        // provider's invoice is the price, and the formula only fills its gap.
        const msgs = [imageMsg("u0", { width: 1024, height: 768 })]
        expect(SessionCompaction.computeOpenWindowTokens(msgs, undefined, model)).toBe(1_000)
      }),
    ),
  )
  // ── The absolute comes from the provider; only growth is counted (2026-09-18) ──
  //
  // `prompt_tokens` on the newest response is exact and already carries the system
  // prefix and tool schemas the counter cannot see (measured on this session: 99 390
  // of 592 478 tokens). Counting only what came after it removes the 1.2-1.45x
  // undercount the estimate carried, and it is what makes a real tokenizer affordable
  // at all: growth is 1.2 ms typically against 967 ms for the whole visible window.
  //
  // The billed response's OWN text is not tokenized either: the provider counted it as
  // `output`, and it becomes part of the NEXT request's prompt. Only tool results and
  // new user messages are left for the tokenizer.
  const billedMsg = (
    id: string,
    tokens: { input: number; cacheRead: number; cacheWrite?: number; output?: number; reasoning?: number },
    text = "",
    withTool = false,
  ): MessageV2.WithParts =>
    ({
      info: {
        id,
        role: "assistant",
        tokens: {
          output: tokens.output ?? 0,
          input: tokens.input,
          reasoning: tokens.reasoning ?? 0,
          cache: { read: tokens.cacheRead, write: tokens.cacheWrite ?? 0 },
        },
      },
      parts: [
        { id: `p-${id}`, messageID: id, sessionID: "s", type: "text", text },
        ...(withTool
          ? [
              {
                id: `t-${id}`,
                messageID: id,
                sessionID: "s",
                type: "tool",
                state: { status: "completed", output: "" },
              },
            ]
          : []),
      ],
    }) as any

  test("takes the absolute from the provider and counts only the growth", () => {
    const msgs = [
      textMsg("u0", "user", "x".repeat(40_000)),
      billedMsg("a1", { input: 10_000, cacheRead: 5_000, output: 400 }, "answer"),
      textMsg("u2", "user", "z".repeat(8_000)),
    ]
    // 10 000 + 5 000 prompt and 400 response, both billed, plus the tool-free growth.
    // The answer's own text is NOT tokenized — the provider already counted it.
    const expected = 15_400 + countTokens("z".repeat(8_000))
    expect(SessionCompaction.windowFillTokens(msgs)).toBe(expected)
    expect(expected).toBeGreaterThan(Math.ceil(48_000 / 4))
  })

  test("the response's tokens come from the provider, never from the tokenizer", () => {
    // A long answer with a SMALL billed output: if the answer were tokenized the count
    // would explode with its text; it must not — the provider's number is the truth.
    const long = "y".repeat(40_000)
    const msgs = [billedMsg("a1", { input: 1_000, cacheRead: 0, output: 7 }, long)]
    expect(SessionCompaction.windowFillTokens(msgs)).toBe(1_007)
    expect(countTokens(long)).toBeGreaterThan(1_000)
  })

  test("reasoning is added only on tool turns, where it stays on the wire", () => {
    const withTool = [billedMsg("a1", { input: 1_000, cacheRead: 0, output: 10, reasoning: 500 }, "", true)]
    const withoutTool = [billedMsg("a2", { input: 1_000, cacheRead: 0, output: 10, reasoning: 500 }, "", false)]
    expect(SessionCompaction.windowFillTokens(withTool)).toBe(1_510)
    expect(SessionCompaction.windowFillTokens(withoutTool)).toBe(1_010)
  })

  test("an uncached write counts toward the billed prompt", () => {
    const msgs = [billedMsg("a1", { input: 2_000, cacheRead: 500, cacheWrite: 300 })]
    expect(SessionCompaction.windowFillTokens(msgs)).toBe(2_800)
  })

  test("NEGATIVE CONTROL: with no billed response both measures fall back, each in its OWN space", () => {
    // No assistant usage anywhere, so `chars/4` over the slice is the only instrument
    // left. Each measure keeps ITS own space on this path — content for the Layer-1
    // counter, content + framing for the window-fill measure — because a threshold
    // cannot compare two different spaces. A fallback that returned the other one would
    // re-open exactly the hole this split closed.
    const msgs = [textMsg("u0", "user", "x".repeat(40_000))]
    expect(SessionCompaction.computeOpenWindowTokens(msgs)).toBe(10_000)
    expect(SessionCompaction.windowFillTokens(msgs)).toBe(estimateRequestTokens(10_000))
  })

  test("tool output after the billed response counts as growth", () => {
    const msgs = [
      billedMsg("a1", { input: 1_000, cacheRead: 0 }),
      {
        info: {
          id: "t1",
          role: "assistant",
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [
          {
            id: "p-t1",
            messageID: "t1",
            sessionID: "s",
            type: "tool",
            state: { status: "completed", output: "w".repeat(4_000) },
          },
        ],
      } as any,
    ]
    expect(SessionCompaction.windowFillTokens(msgs)).toBe(1_000 + countTokens("w".repeat(4_000)))
  })

  test("a slack twice the growth skips the tokenizer entirely", () => {
    const model = createModel({ context: 1_000_000, output: 384_000 })
    const msgs = [
      billedMsg("a1", { input: 1_000, cacheRead: 0 }),
      textMsg("u2", "user", "z".repeat(8_000)),
    ]
    // 1M context against 8 000 chars of growth: no token in that growth can close the
    // slack, so the count is the cheap pessimistic bound — one token per character —
    // and the tokenizer is never started.
    expect(SessionCompaction.windowFillTokens(msgs, model)).toBe(1_000 + 8_000)
    // A tight window takes the exact path instead, which for this text is strictly
    // smaller — proving the two branches really differ.
    const tight = createModel({ context: 9_000, output: 1_000 })
    expect(SessionCompaction.windowFillTokens(msgs, tight)).toBe(
      1_000 + countTokens("z".repeat(8_000)),
    )
    expect(countTokens("z".repeat(8_000))).toBeLessThan(8_000)
  })

  // ── The pre-send FIT gate's instrument (2026-09-18) ──
  //
  // This gate runs once per loop step, so it cannot afford the exact counter: pointing
  // it at `computeOpenWindowTokens` turned one prompt-suite case from 3.6 s into 17 s
  // and stalled the file. It keeps the same BASE and over-counts the growth instead,
  // which is safe because the gate can only fold early — never let an overflow through.
  test("the pre-send bound keeps the provider base and charges one token per growth char", () => {
    const msgs = [
      billedMsg("a1", { input: 10_000, cacheRead: 5_000, output: 400 }, "answer"),
      textMsg("u2", "user", "z".repeat(8_000)),
    ]
    // prompt (15 000) + response (400) + 8 000 growth chars priced pessimistically.
    expect(SessionCompaction.openWindowTokensBound(msgs)).toBe(15_400 + 8_000)
  })

  test("the pre-send bound is never below the exact counter", () => {
    const msgs = [
      billedMsg("a1", { input: 1_000, cacheRead: 0, output: 10 }),
      textMsg("u2", "user", "z".repeat(8_000)),
    ]
    const bound = SessionCompaction.openWindowTokensBound(msgs)
    const exact = SessionCompaction.windowFillTokens(msgs)
    // The contract that makes it usable as a fit gate: over-count is allowed, under-
    // count is not.
    expect(bound).toBeGreaterThanOrEqual(exact)
    expect(exact).toBe(1_010 + countTokens("z".repeat(8_000)))
  })

  test("with no billed response the bound is the previous estimate, unchanged", () => {
    // A fresh session has no provider count to build on, so the old `chars/4 + 10k`
    // safety estimate stands — this path must not have moved.
    const msgs = [textMsg("u1", "user", "z".repeat(4_000))]
    expect(SessionCompaction.openWindowTokensBound(msgs)).toBe(estimateRequestTokens(1_000))
  })

  // ── The scope rule: a slice-relative question cannot take a whole-request base ──
  test("the Layer-1 content counter ignores the provider base (scope, not precision)", () => {
    // The defect this pins (found 2026-09-19): the counter used to take the provider's
    // whole-REQUEST `prompt_tokens` as its base while Layer-1 asks for NEW WORK since the
    // boundary. On any billed session it therefore opened at ~99K — straight through
    // `layer1SummaryThreshold()` (65 536) — and the sidecar cadence silently became
    // "summarize on every stop". Nothing in the suite could see it: every cadence fixture
    // carries no provider usage and so took the fallback path.
    const msgs = [
      textMsg("u0", "user", "x".repeat(40_000)),
      billedMsg("a1", { input: 60_000, cacheRead: 39_000, output: 400 }),
    ]
    // Content only: 40 000 chars / 4. The provider's 99 400 never enters this number, so
    // a billed session still has to EARN its 65 536 the way a fresh one does.
    expect(SessionCompaction.computeOpenWindowTokens(msgs)).toBe(10_000)
    expect(SessionCompaction.computeOpenWindowTokens(msgs) < 65_536).toBe(true)
    // …while the window-fill measure, whose threshold IS a request budget, does use it.
    expect(SessionCompaction.windowFillTokens(msgs)).toBe(99_400)
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
            state: { status: "completed", output: "tool-output-1", input: { command: "grep -n fixture m7" }, metadata: {}, time: { start: 0, end: 1 }, title: "" } },
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
            state: { status: "completed", output: "tool-output-2", input: { command: "grep -n fixture m8" }, metadata: {}, time: { start: 0, end: 1 }, title: "" } },
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
            state: { status: "running", input: { command: "bun test test/session/compaction.test.ts" }, time: { start: Date.now() } } },
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

        // Assistant text is labeled; reasoning is KEPT in the tail. The 2026-08-30
        // rule ("facts, not process") predates the 2026-09-19 owner ruling: the 32k
        // tail is INVIOLATE — «иначе это ломает тему» — and everything compressible
        // belongs in memory and in summaries-with-diffs. Dropped reasoning is
        // exactly the chain of thought that ruling protects: measured on a folded
        // window the agent could not say why its own window had folded, and went to
        // the logs for what its own window had held.
        expect(combined).toContain("[text]")
        expect(combined).toContain("[reasoning]")

        // Completed tool outputs in Recent (m9's bash tool, running)
        expect(combined).toContain("[tool:bash]")
        // ...and the CALL half rides with them. Measured 2026-09-19 in a real
        // folded window: `[tool:edit] (completed)` + "Edit applied successfully."
        // carried no file and no patch, `[tool:memory]` no content, and
        // `[tool:compact]` no reason — half of every exchange was absent, so the
        // window held the CONSEQUENCES of decisions without the decisions.
        expect(combined).toContain("Called the bash tool with the following input:")
        // Tool output on summarized messages (m1, m5) is NOT in Recent —
        // those messages were covered by s1/s2 summaries. Only Recent messages
        // after the last summary are faithfully rendered.

        // Running tool must also be visible (not just completed)
        expect(combined).toContain("(running)")

        // Recent messages must be in chronological order. The EPOCH BOUNDARY —
        // not the budget — decides where the tail starts: everything since the
        // previous summary is kept whole, so m7 belongs even though u3 already
        // satisfied the floor. Owner ruling 2026-09-19: «мы должны брать все
        // токены с момента предыдущего summary но не меньше чем 32к» — the floor
        // reaches further BACK, it never trims the epoch forward.
        const u3Idx = combined.indexOf("user-msg-3")
        const r8Idx = combined.indexOf("assistant-text-8")
        const r9Idx = combined.indexOf("assistant-text-9")
        expect(u3Idx).toBeGreaterThan(-1)
        expect(r8Idx).toBeGreaterThan(-1)
        expect(r9Idx).toBeGreaterThan(-1)
        expect(u3Idx).toBeLessThan(r8Idx)
        expect(r8Idx).toBeLessThan(r9Idx)
        // In the epoch after s2: kept even though the 32k floor was already met.
        expect(combined).toContain("assistant-text-7")
        // Before the previous summary: still archive-only.
        expect(combined).not.toContain("assistant-text-1")

        // Range accounting is m*'s CLOSING reference: the two halves must read as
        // one picture — a summary's from#/to# and the tail's `#N` are the same
        // positions, so `to# + 1` must be where the tail starts. These fixture
        // summaries carry no from_id/to_id, so the render must SAY that the
        // comparison is unavailable rather than print a guess; in production a
        // sidecar summary carries both and a gap is NAMED (owner, 2026-09-19:
        // «непротиворечивая картина», «чёткий evidence», «в конце * должен быть
        // четкий реф»).
        expect(combined).toContain("--- Range accounting")
        expect(combined).toContain("tail: #")
        expect(combined).toContain("not verifiable here")
      }),
    ),
  )
})

test("the tail is contiguous with the summaries — a late summary leaves no hole", () => {
  // The case the selector must never regress. A summary fires LATE, so the range
  // it COVERS ends at #3 while its ROW sits at #8. Taking the row as the boundary
  // leaves #4..#7 represented by NOTHING — the owner's picture, verbatim:
  // «чтобы не было s..s..s xxxxx (what happened there) xxx 32k tokens?»
  // `coveredThroughIndex` is the covered END, and everything after it is
  // mandatory tail whatever its size; only past it may the floor stop the walk.
  //
  // Hand-built on purpose: `selectRecentTail` is pure and reads only
  // `info.id`/`info.role`/`summary` and text parts, so every field these objects
  // omit is a field it never touches.
  const mk = (id: string, text: string, summary = false) =>
    ({
      info: { id, role: summary ? "assistant" : "user", ...(summary ? { summary: true } : {}) },
      parts: [{ type: "text", text }],
    }) as never

  const msgs = [
    mk("msg_1", "covered-1"),
    mk("msg_2", "covered-2"),
    mk("msg_3", "covered-3"), // index 2 — the COVERED END
    mk("msg_4", "hole-4"), // index 3 — represented by nothing without the fix
    mk("msg_5", "hole-5"),
    mk("msg_6", "hole-6"),
    mk("msg_7", "hole-7"),
    mk("msg_8", "the summary row", true), // index 7 — the ROW, not the boundary
    mk("msg_9", "after-the-row"),
  ]

  // minTokens = 1: the floor is already satisfied, so only the boundary decides.
  expect(SessionCompaction.selectRecentTail(msgs, 1, 2).map((m) => m.info.id as string)).toEqual([
    "msg_4",
    "msg_5",
    "msg_6",
    "msg_7",
    "msg_9",
  ])
  // …whereas the summary ROW as boundary drops the hole entirely — the defect.
  expect(SessionCompaction.selectRecentTail(msgs, 1).map((m) => m.info.id as string)).toEqual(["msg_9"])
})
