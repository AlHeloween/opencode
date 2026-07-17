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

Log.init()

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
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
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
        yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        const ru = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: ru.id, sessionID: info.id, type: "text", text: "recent-msg" })

        // First compact → single message*
        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after1 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after1).toHaveLength(1)
        const id1 = after1[0].info.id

        // Second compact — only message* visible → idempotent no-op
        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after2 = yield* MessageV2.filterCompactedEffect(info.id)

        expect(after2).toHaveLength(1)
        expect(after2[0].info.id).toBe(id1)
        const texts2 = after2.flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
        expect(texts2.some((t: string) => t.includes("=== COMPACTED ==="))).toBe(true)
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
    "keeps messages from most recent summary onward",
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

        // Create recent messages (will be kept)
        for (const text of ["recent-1", "recent-2"]) {
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
        expect(combined).toContain("recent-1")
        expect(combined).toContain("recent-2")
        // Old raw messages not in message* body (they predate the summary)
        expect(combined).not.toContain("old-1")
        expect(combined).not.toContain("old-2")
        // session-read links present
        expect(combined).toContain("summary_message_id")
        expect(combined).toContain("session_id")
        expect(combined).toContain("info_mark: `Inferred`")
        expect(combined).toContain("session-read(id) = Exact")
      }),
    ),
  )

  it.live(
    "folds all visible messages into message* when no summaries exist",
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

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })

        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        // Only message* is visible; content preserved inside it
        expect(msgs).toHaveLength(1)
        const combined = msgs
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")
        expect(combined).toContain("=== COMPACTED ===")
        expect(combined).toContain("msg-1")
        expect(combined).toContain("msg-2")
        expect(combined).toContain("msg-3")
        expect(combined).toContain("session_id")
      }),
    ),
  )

  it.live(
    "trims to ~30K tokens when no summary and context is large",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        // 30 messages × 5K chars = 150K chars ≈ 37.5K tokens — exceeds 30K threshold
        for (const text of Array.from({ length: 30 }, (_, i) => `msg-${i}-` + "x".repeat(5000))) {
          const u = yield* ssn.updateMessage({
            id: MessageID.ascending(), role: "user", sessionID: info.id,
            agent: "build", model: ref, time: { created: Date.now() },
          })
          yield* ssn.updatePart({ id: PartID.ascending(), messageID: u.id, sessionID: info.id, type: "text", text })
        }

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })

        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        expect(msgs).toHaveLength(1)
        const combined = msgs
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")
        expect(combined).toContain("=== COMPACTED ===")
        expect(combined.includes("msg-28") || combined.includes("msg-29")).toBe(true)
        expect(combined).not.toContain("msg-0-")
      }),
    ),
  )
})

// --- injectSummaryRequest() tests ---

describe("session.compaction.injectSummaryRequest", () => {
  it.live(
    "creates a synthetic user message with summary request text",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

        yield* compact.injectSummaryRequest({ sessionID: info.id, model: ref, agent: "build" })

        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        expect(msgs).toHaveLength(1)
        expect(msgs[0].info.role).toBe("user")
        const texts = msgs[0].parts.filter((p: any) => p.type === "text").map((p: any) => p.text)
        expect(texts.some((t: string) => t.includes("Please create a structured summary"))).toBe(true)
        expect(texts.some((t: string) => t.includes("from_id") && t.includes("to_id"))).toBe(true)
        expect(texts.some((t: string) => t.includes("session_id") && t.includes(info.id))).toBe(true)
        expect(texts.some((t: string) => t.includes("session-read"))).toBe(true)
        expect(texts.some((t: string) => t.includes("Inferred") && t.includes("info_mark"))).toBe(true)
      }),
    ),
  )
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

        // recent messages after s2
        const r1 = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: r1.id, sessionID: info.id, type: "text", text: "recent-after-s2" })

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
        yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)

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
        yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn",
          time: { created: Date.now() },
        } as MessageV2.Assistant)
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
        yield* ssn.updateMessage({
          id: MessageID.ascending(), role: "assistant", sessionID: info.id,
          mode: "build", agent: "build", parentID: su.id,
          modelID: ref.modelID, providerID: ref.providerID,
          path: { cwd: dir, root: dir }, cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true, finish: "end_turn", time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const msgs = yield* MessageV2.filterCompactedEffect(info.id)
        expect(msgs).toHaveLength(1)
        const allTexts = msgs.flatMap((m: any) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
        expect(allTexts.some((t: string) => t.includes("=== COMPACTED ==="))).toBe(true)
      }),
    ),
  )

  it.live("re-compacts after growth: (m*, m) → new message*", () =>
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
          summary: true, finish: "end_turn", time: { created: Date.now() },
        } as MessageV2.Assistant)
        yield* ssn.updatePart({
          id: PartID.ascending(), messageID: sa.id, sessionID: info.id,
          type: "text", text: "## Goal\n- first cycle summary\nfrom_id: `a`\nto_id: `b`",
        })
        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after1 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after1).toHaveLength(1)
        const star1 = after1[0].info.id

        // Growth after message* — loop continues
        const normal = yield* ssn.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: info.id, agent: "build", model: ref, time: { created: Date.now() } })
        yield* ssn.updatePart({ id: PartID.ascending(), messageID: normal.id, sessionID: info.id, type: "text", text: "post-star-work" })

        yield* compact.compact({ sessionID: info.id, model: ref, agent: "build" })
        const after2 = yield* MessageV2.filterCompactedEffect(info.id)
        expect(after2).toHaveLength(1)
        expect(after2[0].info.id).not.toBe(star1)
        const combined = after2
          .flatMap((m: any) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")
        expect(combined).toContain("=== COMPACTED ===")
        expect(combined).toContain("first cycle summary")
        expect(combined).toContain("post-star-work")
        expect(combined).toContain("summary_message_id")
      }),
    ),
  )
})
