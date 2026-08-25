/**
 * Reproducer for snapshot race condition with instant tool execution.
 *
 * The instant tool-call scenario makes several snapshot consumers reuse one
 * Fossil checkout. `fossil open --force` is required for this non-empty
 * worktree, but reports "already an open tree" for subsequent consumers.
 * The checkout must be reused rather than reinitialized, otherwise the
 * captured snapshot hashes disappear and computeDiff returns an empty diff.
 *
 * This remains a real regression test for the pre-tool snapshot path: the
 * processor captures the first snapshot before the LLM stream begins.
 */
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import fs from "fs/promises"
import path from "path"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionSummary } from "../../src/session/summary"
import { MessageV2 } from "../../src/session/message-v2"
import * as Log from "@opencode-ai/core/util/log"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

// Same layer setup as prompt-effect.test.ts
import { NodeFileSystem } from "@effect/platform-node"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Capability } from "@/capability"
import { Env } from "../../src/env"
import { Question } from "../../src/question"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Todo } from "../../src/session/todo"
import { SessionCompaction } from "../../src/session/compaction"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { ToolRegistry } from "@/tool/registry"
import { Jobs } from "@/jobs"
import { Truncate } from "@/tool/truncate"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "../../src/file/ripgrep"
import { Format } from "../../src/format"

Log.init()

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    callTool: () =>
      Effect.fail(new Error("MCP callTool mock: not connected (hard-fail)")),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeHttp() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    SnapshotFossil.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    status,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(Capability.defaultLayer),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(Layer.provide(SessionSummary.defaultLayer), Layer.provideMerge(deps))
  const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionSummary.defaultLayer,
    SessionPrompt.layer.pipe(
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(SessionSummary.defaultLayer),
      Layer.provideMerge(run),
      Layer.provideMerge(compact),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provideMerge(Jobs.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(SystemPrompt.defaultLayer),
      Layer.provideMerge(deps),
    ),
  )
}

const it = testEffect(makeHttp())

const providerCfg = (url: string) => ({
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
})

it.live("bash-only mutations are snapshotted but stay out of Summary Exact diff", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ dir, llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const summary = yield* SessionSummary.Service
      const config = yield* Config.Service

      expect((yield* config.get()).snapshot).not.toBe(false)

      const session = yield* sessions.create({
        title: "snapshot race test",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })

      // Use bash tool (always registered) to create a file
      const command = `echo 'snapshot race test content' > ${path.join(dir, "race-test.txt")}`
      yield* llm.toolMatch((hit) => JSON.stringify(hit.body).includes("create the file"), "bash", {
        command,
        description: "create test file",
      })
      yield* llm.textMatch((hit) => JSON.stringify(hit.body).includes("bash"), "done")

      // Seed user message
      yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "create the file" }],
      })

      // Run the agent loop
      const result = yield* prompt.loop({ sessionID: session.id })
      expect(result.info.role).toBe("assistant")

      // Verify the file was created
      const filePath = path.join(dir, "race-test.txt")
      const fileExists = yield* Effect.promise(() =>
        fs
          .access(filePath)
          .then(() => true)
          .catch(() => false),
      )
      expect(fileExists).toBe(true)

      // Verify the tool call completed (in the first assistant message)
      const allMsgs = yield* MessageV2.filterCompactedEffect(session.id)
      const tool = allMsgs
        .flatMap((m) => m.parts)
        .find((p): p is MessageV2.ToolPart => p.type === "tool" && p.tool === "bash")
      expect(tool?.state.status).toBe("completed")

      const steps = allMsgs
        .flatMap((m) => m.parts)
        .filter((p): p is MessageV2.StepStartPart | MessageV2.StepFinishPart =>
          p.type === "step-start" || p.type === "step-finish",
        )
      expect(steps.map((p) => p.type)).toContain("step-start")
      expect(steps.map((p) => p.type)).toContain("step-finish")
      const snapshots = steps
        .filter((p) => Boolean(p.snapshot))
        .map((p) => p.snapshot)
      expect(snapshots.length).toBeGreaterThanOrEqual(2)
      expect(snapshots.at(0)).not.toBe(snapshots.at(-1))

      // Fossil captured the bash-created file: step snapshots diverged (:258),
      // so undo/rollback covers it. Summary Exact is deliberately
      // product-tool filediffs only (summary.ts computeDiff — "Fossil is
      // rollback, not memory"): a bash-only mutation must NOT appear in
      // session_diff.
      const diff = yield* summary.diff({ sessionID: session.id })
      expect(diff.filter((d) => d.file.replaceAll("\\", "/").includes("race-test"))).toHaveLength(0)
    }),
    { git: true, config: providerCfg },
  ),
  30000,
)
