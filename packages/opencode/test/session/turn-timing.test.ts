/**
 * R2 of `plans/2026-09-30_turn-commit-slot.md`: the turn's timings are STATE, keyed by the turn.
 *
 * They were one `slog.info("turn.prepare", …)` line in a session-scoped log, and that cost a
 * re-grounding — a turn's numbers were gone by the next day, while the datum has a key (the
 * turn's assistant message) and a keyed datum is state. This test drives a REAL turn through the
 * real processor against a stub LLM and then reads the `step-finish` part BACK OUT of the store:
 * nothing below is asserted from the object the writer handed us.
 *
 * TWO halves, and each alone is a defect:
 *   1. the felt wait — written when the part is created, so a turn that ends carries it;
 *   2. the commit's own cost — which can only arrive LATER, written back by the detached fiber
 *      that nothing joins. A write-back that silently never happens would leave a part that
 *      looks complete, and no other test in this suite would notice.
 */
import { NodeFileSystem } from "@effect/platform-node"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "@/snapshot"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import * as Log from "@opencode-ai/core/util/log"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

Log.init()

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    update: () => Effect.void,
    updateFallback: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
    enrichRange: () => Effect.succeed({ diffs: [] }),
    captureMechanical: () => Effect.succeed(undefined),
  }),
)

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

function providerCfg(url: string) {
  return {
    snapshot: true,
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
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: url,
        },
      },
    },
  }
}

function agent() {
  return {
    name: "build",
    mode: "primary" as const,
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" as const }],
  }
}

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const deps = Layer.mergeAll(
  Session.defaultLayer,
  SnapshotFossil.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.defaultLayer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  LLM.defaultLayer,
  Provider.defaultLayer,
  status,
).pipe(Layer.provideMerge(infra))
const env = Layer.mergeAll(
  TestLLMServer.layer,
  SessionProcessor.layer.pipe(Layer.provide(summary), Layer.provideMerge(deps)),
)

const it = testEffect(env)

const boot = Effect.fn("test.boot")(function* () {
  const processors = yield* SessionProcessor.Service
  const session = yield* Session.Service
  const provider = yield* Provider.Service
  return { processors, session, provider }
})

const user = Effect.fn("TestSession.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const assistant = Effect.fn("TestSession.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  root: string,
) {
  const session = yield* Session.Service
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  yield* session.updateMessage(msg)
  return msg
})

const lastStepFinish = (messageID: MessageID) =>
  MessageV2.parts(messageID)
    .filter((part): part is MessageV2.StepFinishPart => part.type === "step-finish")
    .at(-1)

it.live("a turn's timings are read back from the STORE, never from a log (plan R2)", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const snapshots = yield* Snapshot.Service

        // PRE-WARM the fossil checkout. The commit forked at the turn's close is detached and
        // nothing joins it, so its failure is swallowed by design; without this line a failing
        // fork would make the test read the FIXTURE's state instead of the write-back it means
        // to prove. `track` here is the same call the race test uses to prove the repo is live.
        yield* snapshots.track(undefined)

        yield* llm.text("ok")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "hi")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "hi" }],
          tools: {},
        } satisfies LLM.StreamInput)

        // HALF ONE — the felt wait rides the part itself, so it is readable the moment the turn
        // ends. Read back from the store: `MessageV2.parts` goes to SQLite, not to the writer.
        const ended = lastStepFinish(msg.id)
        expect(ended).toBeDefined()
        expect(typeof ended?.timing?.requestMs).toBe("number")

        // HALF TWO — the commit's cost is NOT knowable when the part is written: the fork has
        // not happened yet. It has to arrive from the detached fiber, so this polls the STORE
        // for it. The assertion is «the write-back lands», not «it took N ms» — a threshold on a
        // wall-clock number would be a flake, not an oracle.
        const withCommit = yield* Effect.gen(function* () {
          for (let attempt = 0; attempt < 100; attempt++) {
            const part = lastStepFinish(msg.id)
            if (part?.timing?.commitMs !== undefined) return part
            yield* Effect.sleep("100 millis")
          }
          return undefined
        })

        expect(withCommit?.timing?.commitMs).toBeGreaterThanOrEqual(0)
        // The commit's own address rides the same write-back. Its ABSENCE is what a failed or
        // aborted commit looks like in state — which is why the fixture must produce a real one.
        expect(withCommit?.timing?.commitHash).toMatch(/^[0-9a-f]{40}$/i)
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
  30_000,
)
