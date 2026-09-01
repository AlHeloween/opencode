import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { createEraMemo, formatTaskAgentInventory, ToolRegistry } from "@/tool/registry"
import { Agent } from "@/agent/agent"
import { ModelID, ProviderID } from "@/provider/schema"
import { SessionID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer, node))

function schemaFingerprint(tools: { id: string; policy: string; description: string; parameters: unknown }[]) {
  return JSON.stringify(tools.map(({ id, policy, description, parameters }) => ({ id, policy, description, parameters })))
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.registry", () => {
  test("formatTaskAgentInventory uses live non-hidden subagents", () => {
    const text = formatTaskAgentInventory([
      { name: "build_mode", mode: "primary", description: "full" },
      { name: "title_agent", mode: "primary", hidden: true, description: "titles" },
      { name: "explorer_agent", mode: "subagent", description: "explore code" },
      { name: "coder_agent", mode: "subagent", description: "implement" },
      { name: "ghost", mode: "subagent", hidden: true, description: "hidden" },
    ])
    expect(text).toContain("explorer_agent")
    expect(text).toContain("coder_agent")
    expect(text).not.toContain("build_mode")
    expect(text).not.toContain("title_agent")
    expect(text).not.toContain("ghost")
    expect(text.indexOf("coder_agent")).toBeLessThan(text.indexOf("explorer_agent"))
  })

  test("createEraMemo freezes values per key until invalidate", () => {
    const memo = createEraMemo()
    expect(memo.get("era-a")).toBeUndefined()
    memo.set("era-a", { task: "task-v1", skill: "skill-v1" })
    expect(memo.get("era-a")).toEqual({ task: "task-v1", skill: "skill-v1" })
    // Second set within the same era keeps the FIRST value semantics via
    // callers skipping compute — the memo itself stores the last set.
    memo.invalidate("era-a")
    expect(memo.get("era-a")).toBeUndefined()
    memo.set("era-a", { task: "task-v2", skill: "skill-v2" })
    expect(memo.get("era-a")).toEqual({ task: "task-v2", skill: "skill-v2" })
    // Other keys are unaffected.
    memo.set("era-b", { task: "task-b", skill: "skill-b" })
    memo.invalidate("era-a")
    expect(memo.get("era-b")).toEqual({ task: "task-b", skill: "skill-b" })
  })

  it.live(
    "era-freezes task/skill descriptions per session until invalidateToolDescriptions",
    () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const agents = yield* Agent.Service
          const build = yield* agents.get("build")
          expect(build).toBeDefined()
          const sid = SessionID.descending()
          const base = {
            providerID: ProviderID.make("test"),
            modelID: ModelID.make("test-model"),
            agent: build!,
          }
          const first = yield* registry.tools({ ...base, sessionID: sid })
          const second = yield* registry.tools({ ...base, sessionID: sid })
          const desc = (tools: { id: string; description: string }[], id: string) =>
            tools.find((tool) => tool.id === id)?.description
          // Same era → identical task/skill descriptions (frozen, not recomputed).
          expect(desc(second, "task")).toBe(desc(first, "task"))
          expect(desc(second, "skill")).toBe(desc(first, "skill"))
          expect(desc(first, "skill")).toBeDefined()
          expect(desc(first, "task")).toBeDefined()
          // Era boundary (compact / system-version bump) refreshes the memo.
          yield* registry.invalidateToolDescriptions(sid)
          const third = yield* registry.tools({ ...base, sessionID: sid })
          expect(desc(third, "task")).toBe(desc(first, "task"))
          expect(desc(third, "skill")).toBe(desc(first, "skill"))
        }),
      ),
  )

  it.live(
    "exposes unique platform-appropriate built-in tool IDs",
    () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const ids = yield* registry.ids()
          expect(new Set(ids).size).toBe(ids.length)
          expect(ids).toSatisfy((names) => names.every((id) => /^[a-z0-9]+$/.test(id)))
          expect(ids).toContain("treediff")
          expect(ids.filter((id) => id === "cmd")).toHaveLength(process.platform === "win32" ? 1 : 0)
        }),
      ),
    10_000,
  )

  it.live("exposes the full shared schema catalogue to reasoning_mode", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const reasoning = yield* agents.get("reasoning")
        const build = yield* agents.get("build")
        expect(reasoning).toBeDefined()
        expect(build).toBeDefined()
        const reasoningTools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: reasoning!,
        })
        const buildTools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: build!,
        })
        expect(schemaFingerprint(reasoningTools)).toBe(schemaFingerprint(buildTools))
        expect(reasoningTools.map((tool) => tool.id)).toContain("memory")
        expect(reasoningTools.map((tool) => tool.id)).toContain("reasoningexit")
      }),
    ),
  )

  it.live("keeps every native identity on the identical ordered schema catalogue", () =>
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
        const all = yield* agents.list()
        const byName = new Map(all.map((agent) => [agent.name, agent]))
        const identities = [
          build!,
          plan!,
          reasoning!,
          orchestrator!,
          byName.get("coder_agent")!,
          byName.get("general_agent")!,
          byName.get("explorer_agent")!,
          byName.get("researcher_agent")!,
          byName.get("media_agent")!,
          { ...orchestrator!, native: false },
        ]
        const catalogues = yield* Effect.forEach(identities, (agent) =>
          registry.tools({
            providerID: ProviderID.make("test"),
            modelID: ModelID.make("test-model"),
            agent,
          }),
        )
        for (const catalogue of catalogues) {
          expect(schemaFingerprint(catalogue)).toBe(schemaFingerprint(catalogues[0]!))
          expect(catalogue.map((tool) => tool.id)).toContain("reasoningenter")
          expect(catalogue.map((tool) => tool.id)).toContain("reasoningexit")
        }
      }),
    ),
  )

  it.live("tool descriptions are agent-independent — plan_mode ≡ build_mode", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agents = yield* Agent.Service
        const build = yield* agents.get("build")
        const plan = yield* agents.get("plan")
        expect(build).toBeDefined()
        expect(plan).toBeDefined()

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

        // All shared tools MUST have identical descriptions for KV-cache stability.
        // If descriptions differ, the provider sees different tool JSON → cache miss.
        const buildById = new Map(buildTools.map((t) => [t.id, t]))
        const planById = new Map(planTools.map((t) => [t.id, t]))

        for (const [id, buildTool] of buildById) {
          const planTool = planById.get(id)
          if (!planTool) continue // tool only in build (e.g. edit/write vs apply_patch)
          expect(planTool.description).toBe(buildTool.description)
          expect(JSON.stringify(planTool.parameters)).toBe(JSON.stringify(buildTool.parameters))
        }

        // Regression guard: Skill tool description MUST be identical.
        // describeSkill(agent) previously returned agent-dependent skill lists,
        // changing the tool JSON per mode → KV-cache break on plan↔build switch.
        const buildSkill = buildById.get("skill")
        const planSkill = planById.get("skill")
        expect(buildSkill).toBeDefined()
        expect(planSkill).toBeDefined()
        expect(planSkill!.description).toBe(buildSkill!.description)
        // Byte-level verify: full tool JSON equality for the Skill tool.
        expect(JSON.stringify(planSkill)).toBe(JSON.stringify(buildSkill))
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
        const build = yield* (yield* Agent.Service).get("build")
        expect(build).toBeDefined()
        const buildTools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: build!,
        })
        expect(schemaFingerprint(tools)).toBe(schemaFingerprint(buildTools))
        expect(tools.find((tool) => tool.id === "memory")?.description).not.toContain("custom memory collision")
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
