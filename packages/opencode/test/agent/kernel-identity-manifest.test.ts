import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "@/agent/agent"
import { resolveTools } from "@/agent/identity-tools"
import { ToolRegistry } from "@/tool/registry"
import { ModelID, ProviderID } from "@/provider/schema"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import manifest from "../../../../prompt_kernel/identity_tools.json"

/**
 * THE LIVE ACL ↔ THE KERNEL'S IDENTITY ROWS — through ONE committed artifact (plan hash-addressed-edits, H10).
 *
 * The kernel tells every identity which tools it has («tools: all except …»), and the runtime decides it in
 * `agent.ts`. The two drifted in silence: on 2026-10-01 the kernel still offered `multiedit` and `applypatch`,
 * which no catalog holds, and gave the researcher five tools its ACL denies — a model that believes its tool row
 * makes moves the runtime refuses (owner: «чтобы потом левых ходов не было»).
 *
 * The runtime stays decoupled from the kernel BUILD (a TS test must not read `reasoning_prompt.txt` —
 * 86e4a5c564). So both sides meet at `prompt_kernel/identity_tools.json`, the output of
 * `script/kernel-tools-manifest.ts`: THIS test fails when `agent.ts` (or the catalog) moves away from it, and
 * `prompt_kernel/tests/test_identity_manifest.py` fails when the kernel rows do. Changing an ACL therefore means:
 * re-run the extractor, commit the JSON, fix the rows — and both suites say when that was skipped.
 */

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer, CrossSpawnSpawner.defaultLayer))

afterEach(async () => {
  await Instance.disposeAll()
})

// `cmd` exists only on win32 (registry: one `cmd` there, none elsewhere), and the manifest was extracted on the
// owner's win32 host — so off win32 the expectation drops `cmd` rather than the test going quiet.
const expected = (ids: readonly string[]) => [...ids].filter((id) => process.platform === "win32" || id !== "cmd")

describe("kernel identity manifest", () => {
  it.live(
    "every native identity's live tool sets equal prompt_kernel/identity_tools.json",
    () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const agents = yield* Agent.Service
          const registry = yield* ToolRegistry.Service
          const names = Object.keys(manifest) as (keyof typeof manifest)[]
          expect(names.length).toBe(9)
          for (const name of names) {
            const agent = yield* agents.get(name)
            expect(agent).toBeDefined()
            const tools = yield* registry.tools({
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: agent!,
            })
            const resolved = Object.entries(resolveTools(agent!, tools))
            const live = {
              allowed: resolved.filter(([, ok]) => ok).map(([id]) => id).sort(),
              denied: resolved.filter(([, ok]) => !ok).map(([id]) => id).sort(),
            }
            // The identity's name rides along, so a red names WHICH identity moved.
            expect({ name, ...live }).toEqual({
              name,
              allowed: expected(manifest[name].allowed),
              denied: expected(manifest[name].denied),
            })
          }
        }),
      ),
    30_000,
  )
})
