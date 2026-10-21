import { afterEach, describe, expect, setDefaultTimeout } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import type { SessionPrompt } from "@/session/prompt"
import { MessageID, PartID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "@/provider/provider"
import { PipelineTool } from "../../src/tool/pipeline"
import type { TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// The pipeline lane's first test measured 17.07s on this host (the tmpdir instance
// setup dominates), so the file carries its own budget instead of bun's 5s default.
setDefaultTimeout(60_000)

afterEach(async () => {
  await Instance.disposeAll()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const testModel = (id: string) => ({
  id,
  name: "Test Model",
  attachment: false,
  reasoning: false,
  temperature: false,
  tool_call: true,
  release_date: "2025-01-01",
  limit: { context: 100000, output: 10000 },
  cost: { input: 0, output: 0 },
  options: {},
})

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Provider.defaultLayer,
    Session.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
    AppFileSystem.defaultLayer,
  ),
)

const seed = Effect.fn("PipelineToolTest.seed")(function* (title = "Piped") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

describe("tool.pipeline", () => {
  it.live(
    "execute resolves the global recents list before the chain thunk reads it",
    () =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const { chat, assistant } = yield* seed()
            const tool = yield* PipelineTool
            const def = yield* tool.init()
            let seen: SessionPrompt.PromptInput | undefined
            const promptOps = stubOps({ text: "step done", onPrompt: (input) => (seen = input) })

            const result = yield* def.execute(
              {
                steps: [{ agent: "general_agent", description: "read the memory", prompt: "run the audit" }],
              },
              {
                sessionID: chat.id,
                messageID: assistant.id,
                agent: "build",
                abort: new AbortController().signal,
                extra: { promptOps },
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

            // The step ran: the tool reached the model resolution and the prompt.
            expect(result.output).toContain("Pipeline completed: 1 steps")
            expect(result.output).toContain("## Step 1: general_agent — read the memory")
            expect(result.output).toContain("step done")
            expect(result.metadata.pipeline[0]?.output).toBe("step done")
            expect(seen?.model?.modelID).toBe(ref.modelID)
            // The step ran in its own sub-session, not the caller's.
            expect(seen?.sessionID).not.toBe(chat.id)
          }),
        {
          config: {
            model: "test/test-model",
            provider: { test: { models: { "test-model": testModel("test-model") } } },
          },
        },
      ),
  )
})
