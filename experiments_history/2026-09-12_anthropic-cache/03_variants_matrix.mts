/**
 * PROBE 03 — thinking variants vs the catalog's own reasoning_options. [offline, no key]
 *
 * ProviderTransform.variants() decides the thinking payload by substring-matching
 * the model id (transform.ts:491 anthropicAdaptiveEfforts). The catalog entry for
 * every model already carries reasoning_options — the authoritative list of what
 * that model accepts. This probe cross-tabs the two and flags:
 *
 *   BUDGET_ON_EFFORT_ONLY — we emit thinking.budgetTokens for a model whose
 *                           catalog entry offers only {type:"effort"}.
 *                           Anthropic removed budget_tokens on those models.
 *   BUDGET_GT_OUTPUT      — budgetTokens >= limit.output; invalid even where
 *                           budget_tokens IS supported (must be < max_tokens).
 *   NO_DISPLAY            — adaptive thinking without display:"summarized";
 *                           those models default to "omitted" (silent reasoning).
 *
 * Offline oracle: it proves what WE emit. The 400 itself is probe 12 (live).
 *
 * Run:  bun run experiments/2026-09-12_anthropic-cache/03_variants_matrix.mts
 */
import path from "path"
import { Glob } from "bun"
import { ProviderTransform } from "../../packages/opencode/src/provider/transform"
import { anthropicModel, REPO, readRepo, table } from "./lib/fixture.mts"

// EVERY provider on the anthropic dialect, not just "anthropic" — the branch in
// variants() is keyed on api.npm, so kimi-for-coding, minimax-coding-plan,
// freemodel, subconscious, thinkingmachines and google-vertex-anthropic all
// land in exactly the same code path (10 providers as of 2026-09-12).
const MODELS_DIR = "packages/opencode/src/provider/models"
const catalogs: { provider: string; npm: string; models: Record<string, any> }[] = []
for (const file of new Glob("*.json").scanSync(path.join(REPO, MODELS_DIR))) {
  const entry = JSON.parse(await readRepo(`${MODELS_DIR}/${file}`))
  const npm = String(entry.npm ?? "")
  if (!npm.includes("anthropic")) continue
  catalogs.push({ provider: entry.id, npm, models: entry.models ?? {} })
}

const rows: Record<string, string>[] = []
const entries = catalogs.flatMap((catalog) =>
  Object.entries<any>(catalog.models).map(([id, entry]) => [catalog, id, entry] as const),
)
for (const [catalog, id, entry] of entries) {
  const model = anthropicModel(id)
  model.providerID = catalog.provider
  model.api.npm = catalog.npm
  model.limit = { context: entry.limit.context, output: entry.limit.output }
  model.capabilities.reasoning = entry.reasoning ?? false
  const variants = ProviderTransform.variants(model)

  const allowed = (entry.reasoning_options ?? []).map((o: any) => o.type)
  const emitted = Object.values<any>(variants)
  const budgets = emitted.map((v) => v?.thinking?.budgetTokens).filter((b) => typeof b === "number")
  const usesAdaptive = emitted.some((v) => v?.thinking?.type === "adaptive")
  const hasDisplay = emitted.some((v) => v?.thinking?.display === "summarized")

  const flags: string[] = []
  if (budgets.length > 0 && !allowed.includes("budget_tokens")) flags.push("BUDGET_ON_EFFORT_ONLY")
  if (budgets.some((b) => b >= entry.limit.output)) flags.push("BUDGET_GT_OUTPUT")
  if (usesAdaptive && !hasDisplay) flags.push("NO_DISPLAY")

  rows.push({
    provider: catalog.provider,
    model: id,
    "catalog reasoning_options": allowed.join(",") || "-",
    "variants emitted": Object.keys(variants).join(",") || "(none)",
    mode: usesAdaptive ? "adaptive" : budgets.length ? `budgetTokens=${budgets.join("/")}` : "-",
    "out limit": String(entry.limit.output),
    flags: flags.join(" ") || "ok",
  })
}

console.log("\n=== ProviderTransform.variants() vs catalog reasoning_options ===")
console.log(table(rows))

const broken = rows.filter((r) => r.flags !== "ok")
console.log(`\n${broken.length}/${rows.length} models flagged across ${catalogs.length} providers on the anthropic dialect`)
const perProvider = new Map<string, number>()
for (const row of broken) perProvider.set(row.provider!, (perProvider.get(row.provider!) ?? 0) + 1)
console.log(
  table(
    catalogs.map((c) => ({
      provider: c.provider,
      npm: c.npm,
      models: Object.keys(c.models).length,
      flagged: perProvider.get(c.provider) ?? 0,
    })) as any,
  ),
)
process.exitCode = broken.some((r) => r.flags!.includes("BUDGET_ON_EFFORT_ONLY")) ? 1 : 0
