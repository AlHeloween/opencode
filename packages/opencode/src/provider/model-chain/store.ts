/**
 * Chain persistence (t68, C1): the key namespace for explicit model chains.
 *
 * One row per (scope, agent) in `model_chain` (`chain.sql.ts`, created in
 * `storage/db.ts` CORE_SCHEMA_SQL) — the same single-row-blob split
 * `session_epistemic` uses, because LMDB is not deployed yet. Key shape:
 * `session:<id>:agent:<name>:chain` (`chainKey`); scope `global` and
 * `worktree:<id>` share the (scope, agent) row scheme.
 *
 * The store is an ENHANCEMENT, never a precondition (same contract as
 * `epistemic-store.ts`): with no instance context (unit tests, tooling)
 * reads return `undefined` and writes are a debug-logged no-op — the
 * callers keep the behaviour they had before this row existed. A store
 * that was supposed to persist and did not is a defect (warn + `bug:`).
 *
 * FILL, never resolve: `ensureChainFilled` writes the parent copy exactly
 * once (creation, or one-time backfill); `loadChain` reads ONE key and
 * never walks to a parent.
 */
import { and, eq } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Database } from "@/storage/db"
import { ModelChainTable } from "./chain.sql"
import { fillChainForNewLayer, readChainLayer, shouldBackfill } from "./chain"
import type { ChainMember, ChainScope } from "./chain"

const log = Log.create({ service: "provider.model-chain-store" })

function storeFailure(op: string, scope: ChainScope, agent: string, cause: unknown) {
  const error = String(cause)
  const detail = { op, scope, agent, error }
  if (error.includes("No context found for database")) {
    log.debug("model-chain store unavailable — the chain stays in memory", detail)
    return
  }
  log.warn("bug: model-chain store failed", detail)
}

function encode(members: ChainMember[]): string {
  return JSON.stringify(members.map((member) => ({ ...member })))
}

/** This layer's chain, or `undefined` when nothing was ever written (or nothing is open). Never a parent. */
export function loadChain(scope: ChainScope, agent: string): ChainMember[] | undefined {
  try {
    return Database.use((db) => {
      const row = db
        .select({ data: ModelChainTable.data })
        .from(ModelChainTable)
        .where(and(eq(ModelChainTable.scope, scope), eq(ModelChainTable.agent, agent)))
        .all()[0]
      if (!row) return undefined
      try {
        return readChainLayer(JSON.parse(row.data))
      } catch {
        return undefined
      }
    })
  } catch (cause) {
    storeFailure("load", scope, agent, cause)
    return undefined
  }
}

/** Replace this layer's chain (explicit user pick). Never touches another layer. */
export function saveChain(scope: ChainScope, agent: string, members: ChainMember[]): void {
  const now = Date.now()
  const data = encode(members)
  try {
    Database.use((db) => {
      db.insert(ModelChainTable)
        .values({ scope, agent, data, time_created: now, time_updated: now })
        .onConflictDoUpdate({
          target: [ModelChainTable.scope, ModelChainTable.agent],
          set: { data, time_updated: now },
        })
        .run()
    })
  } catch (cause) {
    storeFailure("save", scope, agent, cause)
  }
}

/**
 * Fill-once: copy the parent layer's chain into a layer that holds none.
 * Returns the layer's chain afterwards (existing or freshly filled), or
 * `undefined` when neither layer holds one. Writes at most once.
 */
export function ensureChainFilled(
  scope: ChainScope,
  agent: string,
  parent: ChainMember[] | undefined,
): ChainMember[] | undefined {
  const existing = loadChain(scope, agent)
  if (!shouldBackfill(existing)) return existing
  const filled = fillChainForNewLayer(parent)
  if (filled === undefined) return undefined
  saveChain(scope, agent, filled)
  return filled
}
