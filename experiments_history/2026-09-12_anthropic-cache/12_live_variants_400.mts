/**
 * PROBE 12 - LIVE: does what variants() emits today actually 400? [needs ANTHROPIC_API_KEY]
 *
 * Decisive oracle for probe 03. For each model: send the thinking payload
 * ProviderTransform.variants() produces for the "max" variant, then send the
 * adaptive+effort payload the fix would produce. Report the status verbatim.
 *
 * PASS for the fix: arm "current" errors, arm "proposed" returns 200 OK.
 *
 * Run:  ANTHROPIC_API_KEY=... bun run experiments/2026-09-12_anthropic-cache/12_live_variants_400.mts
 *       PROBE_MODELS=claude-opus-5,claude-haiku-4-5 ... (override the target list)
 */
import { ProviderTransform } from "../../packages/opencode/src/provider/transform"
import { anthropicModel, readRepo, table } from "./lib/fixture.mts"
import { client, requireKey } from "./lib/live.mts"

requireKey("12_live_variants_400.mts")
const catalog = JSON.parse(await readRepo("packages/opencode/src/provider/models/anthropic.json"))
const TARGETS = (process.env.PROBE_MODELS ?? "claude-opus-5,claude-opus-4-8,claude-fable-5,claude-sonnet-4-5").split(",")

const prompt: any[] = [
  { role: "system", content: "You are a probe. Answer with one word." },
  { role: "user", content: [{ type: "text", text: "ok?" }] },
]

const rows: Record<string, string>[] = []
for (const id of TARGETS) {
  const entry = catalog.models[id]
  if (!entry) {
    rows.push({ model: id, arm: "-", payload: "-", result: "NOT IN CATALOG" })
    continue
  }
  const model = anthropicModel(id)
  model.limit = { context: entry.limit.context, output: entry.limit.output }
  model.capabilities.reasoning = entry.reasoning ?? false
  const variants = ProviderTransform.variants(model)

  const arms: [string, any][] = [
    ["current (variants.max)", variants.max ?? variants.high ?? {}],
    ["proposed (adaptive+effort)", { thinking: { type: "adaptive", display: "summarized" }, effort: "max" }],
  ]
  for (const [arm, options] of arms) {
    try {
      await client()(id).doGenerate({ prompt, maxOutputTokens: 2048, providerOptions: { anthropic: options } })
      rows.push({ model: id, arm, payload: JSON.stringify(options), result: "200 OK" })
    } catch (error: any) {
      rows.push({
        model: id,
        arm,
        payload: JSON.stringify(options),
        result: `ERROR ${String(error?.message ?? error).slice(0, 140)}`,
      })
    }
  }
}

console.log("\n=== live thinking payload matrix ===")
console.log(table(rows))
