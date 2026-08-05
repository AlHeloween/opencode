import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import type { Agent } from "../../src/agent/agent"
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
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Log from "@opencode-ai/core/util/log"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

Log.init()

// ── Test Setup (from processor-effect.test.ts) ─────────────────────────

const summary = Layer.succeed(SessionSummary.Service, SessionSummary.Service.of({
  summarize: () => Effect.void,
  update: () => Effect.void,
  updateFallback: () => Effect.void,
  diff: () => Effect.succeed([]),
  computeDiff: () => Effect.succeed([]),
  enrichRange: () => Effect.succeed({ diffs: [] }),
}))

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

const cfg = {
  provider: {
    test: {
      name: "Test", id: "test", env: [],
      npm: "@ai-sdk/openai-compatible",
      models: { "test-model": { id: "test-model", name: "Test Model", attachment: false, reasoning: false, temperature: false, tool_call: true, release_date: "2025-01-01", limit: { context: 100000, output: 10000 }, cost: { input: 0, output: 0 }, options: {} } },
      options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
    },
  },
}

function providerCfg(url: string) {
  return { ...cfg, provider: { ...cfg.provider, test: { ...cfg.provider.test, options: { ...cfg.provider.test.options, baseURL: url } } } }
}

function agent(): Agent.Info {
  return { name: "build", mode: "primary", options: {}, permission: [{ permission: "*", pattern: "*", action: "allow" }] }
}

const user = Effect.fn("TestSession.user")(function* (sid: SessionID, text: string) {
  const s = yield* Session.Service
  const m = yield* s.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: sid, agent: "build", model: ref, time: { created: Date.now() } })
  yield* s.updatePart({ id: PartID.ascending(), messageID: m.id, sessionID: sid, type: "text", text })
  return m
})

const assistant = Effect.fn("TestSession.assistant")(function* (sid: SessionID, parent: MessageID, root: string) {
  const s = yield* Session.Service
  const m: MessageV2.Assistant = { id: MessageID.ascending(), role: "assistant", sessionID: sid, mode: "build", agent: "build", path: { cwd: root, root }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, modelID: ref.modelID, providerID: ref.providerID, parentID: parent, time: { created: Date.now() } }
  yield* s.updateMessage(m)
  return m
})

const sts = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const deps = Layer.mergeAll(Session.defaultLayer, SnapshotFossil.defaultLayer, AgentSvc.defaultLayer, Permission.defaultLayer, Plugin.defaultLayer, Config.defaultLayer, LLM.defaultLayer, Provider.defaultLayer, sts).pipe(Layer.provideMerge(infra))
const pEnv = SessionProcessor.layer.pipe(Layer.provide(summary), Layer.provideMerge(deps))
const env = Layer.mergeAll(TestLLMServer.layer, pEnv)
const it = testEffect(env)

// ═════════════════════════════════════════════════════════════════════
// Bug #1: Disguised inline tool calls — detection
// ═════════════════════════════════════════════════════════════════════

describe("DeepSeek bug defences — retry flow", () => {
  it.live("Bug #1: disguised inline tool call detected and error set", () =>
    provideTmpdirServer(({ dir, llm }) => Effect.gen(function* () {
      const proc = yield* SessionProcessor.Service
      const session = yield* Session.Service
      const pvdr = yield* Provider.Service

      yield* llm.push(
        reply().text('I will fix this:\nwrite{"filePath": "/src/auth.ts", "content": "// fixed"}').stop().item(),
        reply().tool("write", { filePath: "/src/auth.ts", content: "// fixed" }).item(),
      )

      const chat = yield* session.create({})
      const parent = yield* user(chat.id, "Fix the auth bug")
      const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
      const mdl = yield* pvdr.getModel(ref.providerID, ref.modelID)
      const h = yield* proc.create({ assistantMessage: msg, sessionID: chat.id, model: mdl, agentName: "build" })

      const value = yield* h.process({
        user: { id: parent.id, sessionID: chat.id, role: "user", time: parent.time, agent: parent.agent, model: { providerID: ref.providerID, modelID: ref.modelID } } satisfies MessageV2.User,
        sessionID: chat.id, model: mdl, agent: agent(), system: [], messages: [{ role: "user", content: "Fix the auth bug" }],
        tools: { write: { description: "Write a file", parameters: {} as any, execute: async (args: any) => ({ title: `Write ${args.filePath}`, output: "ok", metadata: {} }) } } as any,
        abort: new AbortController().signal,
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })

      expect(value).toBe("stop")
      expect(yield* llm.calls).toBe(1)
      expect(h.message.error).toBeDefined()
      expect(h.message.error!.name).toBe("UnknownError")
    }), { git: true, config: (url) => providerCfg(url) }, 30_000),
  )

  it.live("Bug #1: plain text response passes through without retry", () =>
    provideTmpdirServer(({ dir, llm }) => Effect.gen(function* () {
      const proc = yield* SessionProcessor.Service
      const session = yield* Session.Service
      const pvdr = yield* Provider.Service

      yield* llm.text("The answer is 4.")

      const chat = yield* session.create({})
      const parent = yield* user(chat.id, "What is 2+2?")
      const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
      const mdl = yield* pvdr.getModel(ref.providerID, ref.modelID)
      const h = yield* proc.create({ assistantMessage: msg, sessionID: chat.id, model: mdl, agentName: "build" })

      const value = yield* h.process({
        user: { id: parent.id, sessionID: chat.id, role: "user", time: parent.time, agent: parent.agent, model: { providerID: ref.providerID, modelID: ref.modelID } } satisfies MessageV2.User,
        sessionID: chat.id, model: mdl, agent: agent(), system: [], messages: [{ role: "user", content: "What is 2+2?" }],
        tools: {}, abort: new AbortController().signal,
      })

      expect(value).toBe("continue")
      expect(yield* llm.calls).toBe(1)
      expect(h.message.error).toBeUndefined()
      expect(h.message.finish).toBe("stop")
    }), { git: true, config: (url) => providerCfg(url) }, 30_000),
  )

  it.live("Bug #1: unparseable inline content — no false positive", () =>
    provideTmpdirServer(({ dir, llm }) => Effect.gen(function* () {
      const proc = yield* SessionProcessor.Service
      const session = yield* Session.Service
      const pvdr = yield* Provider.Service

      yield* llm.push(
        reply().text('write{"filePath": "/x.txt", "content": broken}').stop().item(),
      )

      const chat = yield* session.create({})
      const parent = yield* user(chat.id, "Write bad JSON")
      const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
      const mdl = yield* pvdr.getModel(ref.providerID, ref.modelID)
      const h = yield* proc.create({ assistantMessage: msg, sessionID: chat.id, model: mdl, agentName: "build" })

      const value = yield* h.process({
        user: { id: parent.id, sessionID: chat.id, role: "user", time: parent.time, agent: parent.agent, model: { providerID: ref.providerID, modelID: ref.modelID } } satisfies MessageV2.User,
        sessionID: chat.id, model: mdl, agent: agent(), system: [], messages: [{ role: "user", content: "Write bad JSON" }],
        tools: { write: { description: "Write a file", parameters: {} as any, execute: async () => ({ title: "ok", output: "ok", metadata: {} }) } } as any,
        abort: new AbortController().signal, retries: 1,
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })

      expect(value).toBe("continue")
      expect(yield* llm.calls).toBe(1)
      expect(h.message.error).toBeUndefined()
    }), { git: true, config: (url) => providerCfg(url) }, 30_000),
  )
})

// ═════════════════════════════════════════════════════════════════════
// Bug #2: reasoning_content preservation
// ═════════════════════════════════════════════════════════════════════

describe("DeepSeek bug defences — reasoning_content", () => {
  it.live("Bug #2: reasoning captured from stream and preserved in parts", () =>
    provideTmpdirServer(({ dir, llm }) => Effect.gen(function* () {
      const proc = yield* SessionProcessor.Service
      const session = yield* Session.Service
      const pvdr = yield* Provider.Service

      yield* llm.push(reply().reason("I should check the auth module first.").text("The auth module looks correct.").stop())

      const chat = yield* session.create({})
      const parent = yield* user(chat.id, "Analyze the code")
      const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
      const mdl = yield* pvdr.getModel(ref.providerID, ref.modelID)
      const h = yield* proc.create({ assistantMessage: msg, sessionID: chat.id, model: mdl, agentName: "build" })

      yield* h.process({
        user: { id: parent.id, sessionID: chat.id, role: "user", time: parent.time, agent: parent.agent, model: { providerID: ref.providerID, modelID: ref.modelID } } satisfies MessageV2.User,
        sessionID: chat.id, model: mdl, agent: agent(), system: [], messages: [{ role: "user", content: "Analyze the code" }],
        tools: {}, abort: new AbortController().signal,
      })

      const parts = MessageV2.parts(msg.id)
      const reasoning = parts.find((p): p is MessageV2.ReasoningPart => p.type === "reasoning")
      const text = parts.find((p): p is MessageV2.TextPart => p.type === "text")

      expect(yield* llm.calls).toBe(1)
      expect(reasoning?.text).toBe("I should check the auth module first.")
      expect(text?.text).toBe("The auth module looks correct.")
    }), { git: true, config: (url) => providerCfg(url) }, 30_000),
  )
})
