import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

/**
 * Explicit model chains, one row per (scope, agent) — the key namespace
 * for t68 (takes the place LMDB would hold when the fast plane lands).
 *
 * Key shape: `scope` is `global`, `worktree:<id>` or `session:<id>`;
 * the full address is `${scope}:agent:${agent}:chain` (`chainKey`).
 * `data` is the JSON blob `ChainMember[]` as written, read back whole —
 * the codec lives with the type (`chain.ts`), the same split
 * `session_epistemic` uses. FILL, never resolve: a layer's row is written
 * once at creation/backfill and read as a plain lookup of its own key.
 */
export const ModelChainTable = sqliteTable("model_chain", {
  /** `global` | `worktree:<id>` | `session:<id>`. */
  scope: text().notNull(),
  /** Canonical agent name (`build_mode`, …). */
  agent: text().notNull(),
  /** JSON `ChainMember[]` — explicit order, never merged. */
  data: text().notNull(),
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
})
