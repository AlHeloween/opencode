import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

/**
 * Per-model facts the PROVIDER itself taught us — recorded at the rejection, read as a
 * plain lookup.
 *
 * Why a row per model: acceptance is not advertised (an OpenAI-compatible endpoint
 * publishes no request schema; Zen Go docs declare no per-model parameters — measured
 * 2026-10-12), so the authority is the provider's own answer — a `400 [unknown_parameter]
 * … unknown field "X"` names exactly what not to send, an overflow message names the true
 * context limit. Those answers live here so no incident becomes a hand-coded exception.
 *
 * `data` is a JSON blob `{ unsupportedParams: string[], contextLimit?: number }`, stored
 * as written and read back whole — the codec lives with the module that owns the type
 * (`learned-facts.ts`), the same split `session_epistemic` uses.
 */
export const ProviderFactTable = sqliteTable("provider_fact", {
  /** `${providerID}/${modelID}` with the variant suffix stripped. */
  id: text().primaryKey(),
  provider_id: text().notNull(),
  model_id: text().notNull(),
  data: text().notNull(),
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
})
