import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
import { Agent } from "@/agent/agent"
import { ModelID, ProviderID } from "@/provider/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer, node))

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.registry", () => {
  it.live(
    "exposes unique platform-appropriate built-in tool IDs",
    () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const ids = yield* registry.ids()
          expect(new Set(ids).size).toBe(ids.length)
          expect(ids.filter((id) => id === "cmd")).toHaveLength(process.platform === "win32" ? 1 : 0)
        }),
      ),
    10_000,
  )

  it.live("exposes only memory to the protected reasoning agent", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const reasoning = yield* agents.get("reasoning")
        expect(reasoning).toBeDefined()
        const tools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: reasoning!,
        })
        expect(tools.map((tool) => tool.id)).toEqual(["memory"])
      }),
    ),
  )

  it.live("exposes reasoning transitions only to the native orchestrator", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const build = yield* agents.get("build")
        const plan = yield* agents.get("plan")
        const reasoning = yield* agents.get("reasoning")
        const orchestrator = yield* agents.get("orchestrator")
        expect(build).toBeDefined()
        expect(plan).toBeDefined()
        expect(reasoning).toBeDefined()
        expect(orchestrator).toBeDefined()
        const buildTools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: build!,
        })
        const planTools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: plan!,
        })
        const reasoningTools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: reasoning!,
        })
        const spoofedTools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: { ...orchestrator!, native: false },
        })
        const orchestratorTools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: orchestrator!,
        })
        expect(buildTools.map((tool) => tool.id)).not.toContain("reasoning_enter")
        expect(buildTools.map((tool) => tool.id)).not.toContain("reasoning_exit")
        expect(planTools.map((tool) => tool.id)).not.toContain("reasoning_enter")
        expect(planTools.map((tool) => tool.id)).not.toContain("reasoning_exit")
        expect(reasoningTools.map((tool) => tool.id)).toEqual(["memory"])
        expect(spoofedTools.map((tool) => tool.id)).not.toContain("reasoning_enter")
        expect(spoofedTools.map((tool) => tool.id)).not.toContain("reasoning_exit")
        expect(orchestratorTools.map((tool) => tool.id)).toContain("reasoning_enter")
        expect(orchestratorTools.map((tool) => tool.id)).toContain("reasoning_exit")
      }),
    ),
  )

  it.live("does not let a custom memory tool shadow protected reasoning memory", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const toolDir = path.join(dir, ".opencode", "tool")
        yield* Effect.promise(() => fs.mkdir(toolDir, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(toolDir, "memory.ts"),
            [
              "export default {",
              "  description: 'custom memory collision',",
              "  args: {},",
              "  execute: async () => 'must not execute',",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const reasoning = yield* (yield* Agent.Service).get("reasoning")
        expect(reasoning).toBeDefined()
        const tools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: reasoning!,
        })
        expect(tools).toHaveLength(1)
        expect(tools[0]?.description).not.toContain("custom memory collision")
      }),
    ),
  )

  it.live("loads tools from .opencode/tool (singular)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const opencode = path.join(dir, ".opencode")
        const tool = path.join(opencode, "tool")
        yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tool, "hello.ts"),
            [
              "export default {",
              "  description: 'hello tool',",
              "  args: {},",
              "  execute: async () => {",
              "    return 'hello world'",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("hello")
      }),
    ),
  )

  it.live("loads tools from .opencode/tools (plural)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const opencode = path.join(dir, ".opencode")
        const tools = path.join(opencode, "tools")
        yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tools, "hello.ts"),
            [
              "export default {",
              "  description: 'hello tool',",
              "  args: {},",
              "  execute: async () => {",
              "    return 'hello world'",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("hello")
      }),
    ),
  )

  it.live("loads tools with external dependencies without crashing", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const opencode = path.join(dir, ".opencode")
        const tools = path.join(opencode, "tools")
        yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(opencode, "package.json"),
            JSON.stringify({
              name: "custom-tools",
              dependencies: {
                "@opencode-ai/plugin": "^0.0.0",
                cowsay: "^1.6.0",
              },
            }),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(opencode, "package-lock.json"),
            JSON.stringify({
              name: "custom-tools",
              lockfileVersion: 3,
              packages: {
                "": {
                  dependencies: {
                    "@opencode-ai/plugin": "^0.0.0",
                    cowsay: "^1.6.0",
                  },
                },
              },
            }),
          ),
        )

        const cowsay = path.join(opencode, "node_modules", "cowsay")
        yield* Effect.promise(() => fs.mkdir(cowsay, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(cowsay, "package.json"),
            JSON.stringify({
              name: "cowsay",
              type: "module",
              exports: "./index.js",
            }),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(cowsay, "index.js"),
            ["export function say({ text }) {", "  return `moo ${text}`", "}", ""].join("\n"),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tools, "cowsay.ts"),
            [
              "import { say } from 'cowsay'",
              "export default {",
              "  description: 'tool that imports cowsay at top level',",
              "  args: { text: { type: 'string' } },",
              "  execute: async ({ text }: { text: string }) => {",
              "    return say({ text })",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("cowsay")
      }),
    ),
  )
})
