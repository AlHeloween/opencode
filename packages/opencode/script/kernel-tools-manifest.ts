#!/usr/bin/env bun
/**
 * Kernel identity-tools manifest.
 *
 * Prints, for every native identity, the tool sets computed from the LIVE rulesets in
 * `src/agent/agent.ts` — the source the kernel identity add-ons are filled from. This is the
 * extractor half of the "extractor + parity test" pair: the add-on rows are copy-pasted from
 * this output, and `test/agent/kernel-identity-tools.test.ts` fails when the rendered kernel
 * drifts from the live ACL.
 *
 * Run from the repository root:  bun run packages/opencode/script/kernel-tools-manifest.ts
 * (or from this package:         bun run script/kernel-tools-manifest.ts)
 */
import { Effect } from "effect"
import { bootstrap } from "../src/cli/bootstrap"
import { AppRuntime } from "@/effect/app-runtime"
import { Agent } from "@/agent/agent"
import { ToolRegistry } from "@/tool/registry"
import { Provider } from "@/provider/provider"
import { resolveTools } from "@/agent/identity-tools"

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

await bootstrap(process.cwd(), async () => {
  const manifest = await AppRuntime.runPromise(
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const registry = yield* ToolRegistry.Service
      const provider = yield* Provider.Service
      const output: Record<string, { allowed: string[]; denied: string[] }> = {}
      for (const name of IDENTITIES) {
        const agent = yield* agents.get(name)
        const model = agent.model ?? (yield* provider.defaultModel())
        const tools = yield* registry.tools({ ...model, agent })
        const resolved = resolveTools(agent, tools)
        const allowed = Object.entries(resolved)
          .filter(([, ok]) => ok)
          .map(([id]) => id)
          .sort()
        const denied = Object.entries(resolved)
          .filter(([, ok]) => !ok)
          .map(([id]) => id)
          .sort()
        output[name] = { allowed, denied }
      }
      return output
    }),
  )
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n")
})
// The runtime keeps background fibers alive after bootstrap; the manifest is printed — exit.
process.exit(0)
