import { afterEach, expect, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "@/agent/agent"
import { agentDeniesPolicy, resolveTools } from "@/agent/identity-tools"
import { Permission } from "@/permission"
import { ModelID, ProviderID } from "@/provider/schema"
import { ToolRegistry } from "@/tool/registry"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer, node))

afterEach(async () => {
  await Instance.disposeAll()
})

/** Runtime identity → kernel symbol is `toUpperCase()`: build_mode → BUILD_MODE. */
const IDENTITIES = [
  "build_mode",
  "plan_mode",
  "reasoning_mode",
  "orchestrator_agent",
  "explorer_agent",
  "researcher_agent",
  "general_agent",
  "coder_agent",
  "media_agent",
] as const

/**
 * The parity guard for the kernel identity tool rows (prompt_kernel IDENTITY_ADDONS).
 *
 * The provider tool catalogue is deliberately identical for every identity (KV prefix), so the
 * rows are the only place an identity learns what its ACL actually allows — they must not drift
 * from `agent.ts`. Filled by `script/kernel-tools-manifest.ts`; a failure here means the kernel
 * was not re-rendered/re-installed after an ACL change, or a row was edited by hand.
 */
const KERNEL_PATH = path.resolve(import.meta.dir, "../../src/session/prompt/reasoning_prompt.txt")

type ToolRow = { mode: "only" | "except"; ids: string[] }

function parseToolRow(body: string): ToolRow {
  const [head] = body.split(";")
  const text = (head ?? "").trim()
  const clean = (item: string) => item.trim().replace(/\.+$/, "")
  const split = (part: string) => part.split(",").map(clean).filter(Boolean)
  const except = /^all except (.*)$/.exec(text)
  if (except) return { mode: "except", ids: split(except[1]!) }
  return { mode: "only", ids: split(text) }
}

function parseKernelTools(kernel: string): Map<string, ToolRow> {
  const section = kernel.slice(kernel.indexOf("## 5. IDENTITY_CONTRACTS"))
  const rows = new Map<string, ToolRow>()
  for (const block of section.split(/^### /m).slice(1)) {
    const id = block.split("\n", 1)[0]!.trim()
    const row = block.split("\n").find((line) => line.startsWith("tools:"))
    if (!row) continue
    rows.set(id, parseToolRow(row.slice("tools:".length)))
  }
  return rows
}

it.live("identity tools rows in the kernel match the live ACL", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const registry = yield* ToolRegistry.Service
      const kernel = yield* Effect.promise(() => Bun.file(KERNEL_PATH).text())
      const rows = parseKernelTools(kernel)
      const failures: string[] = []
      for (const runtime of IDENTITIES) {
        const agent = yield* agents.get(runtime)
        const tools = yield* registry.tools({ providerID: ProviderID.make("test"), modelID: ModelID.make("test-model"), agent })
        const resolved = resolveTools(agent, tools)
        const allowed = new Set(Object.entries(resolved).filter(([, ok]) => ok).map(([id]) => id))
        const all = Object.keys(resolved)
        const row = rows.get(runtime.toUpperCase())
        if (!row) {
          failures.push(`${runtime}: kernel has no tools row`)
          continue
        }
        const expected =
          row.mode === "except" ? new Set(all.filter((id) => !row.ids.includes(id))) : new Set(row.ids)
        const aclOnly = [...allowed].filter((id) => !expected.has(id)).sort()
        const rowOnly = [...expected].filter((id) => !allowed.has(id)).sort()
        if (aclOnly.length || rowOnly.length) {
          failures.push(`${runtime}: acl-only=[${aclOnly}] row-only=[${rowOnly}]`)
        }
      }
      expect(failures).toEqual([])
    }),
  ),
)

it.live("a flat deny is not reopened by a scoped ask outside the edit family", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const reasoning = yield* agents.get("reasoning_mode")
      const researcher = yield* agents.get("researcher_agent")
      // `read` is denied for both; the defaults' `read: { "*.env": "ask" }` must not count as a
      // scoped open (it is a refinement inside the rule, not an edit-family carve-out).
      expect(agentDeniesPolicy(reasoning, "read")).toBe(true)
      expect(agentDeniesPolicy(researcher, "read")).toBe(true)
      expect(agentDeniesPolicy(researcher, "dbread")).toBe(true)
      // And Permission.disabled must agree — it feeds `opencode debug agent`.
      expect(Permission.disabled(["read"], reasoning.permission).has("read")).toBe(true)
      // The edit-family carve-out itself still works (plan_mode may write plans/ only).
      const plan = yield* agents.get("plan_mode")
      expect(Permission.disabled(["edit"], plan.permission).has("edit")).toBe(false)
    }),
  ),
)

it.live("a deny key that misses the tool policy is dead (jobkill regression)", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      for (const runtime of ["plan_mode", "explorer_agent", "coder_agent"] as const) {
        const agent = yield* agents.get(runtime)
        expect(agentDeniesPolicy(agent, "job_kill")).toBe(true)
      }
      const build = yield* agents.get("build_mode")
      expect(agentDeniesPolicy(build, "job_kill")).toBe(false)
    }),
  ),
)

it.live("only build_mode, coder_agent and media_agent mutate without a path scope", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const unscoped: string[] = []
      for (const runtime of IDENTITIES) {
        const agent = yield* agents.get(runtime)
        if (agentDeniesPolicy(agent, "edit")) continue
        const scopedAllow = agent.permission.some(
          (rule) =>
            ["edit", "write", "apply_patch"].includes(rule.permission) &&
            rule.pattern !== "*" &&
            (rule.action === "allow" || rule.action === "ask"),
        )
        if (!scopedAllow) unscoped.push(runtime)
      }
      expect(unscoped.sort()).toEqual(["build_mode", "coder_agent", "media_agent"])
    }),
  ),
)
