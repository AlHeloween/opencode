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


/** Every agent chain one layer holds, keyed by agent. One query, no agent registry needed. */
export function loadScopeChains(scope: ChainScope): Record<string, ChainMember[]> {
  try {
    return Database.use((db) => {
      const rows = db
        .select({ agent: ModelChainTable.agent, data: ModelChainTable.data })
        .from(ModelChainTable)
        .where(eq(ModelChainTable.scope, scope))
        .all()
      const out: Record<string, ChainMember[]> = {}
      for (const row of rows) {
        try {
          const members = readChainLayer(JSON.parse(row.data))
          if (members !== undefined) out[row.agent] = members
        } catch {
          continue
        }
      }
      return out
    })
  } catch (cause) {
    storeFailure("load-scope", scope, "*", cause)
    return {}
  }
}

/**
 * Pure parent choice for a session being born: the first non-empty layer in
 * `session:<parentID>` → `worktree:<id>` → `global` order wins, and the
 * winner's per-agent chains are copied (never aliased, never merged).
 */
export function planSessionFill(
  parents: Array<{ scope: ChainScope; chains: Record<string, ChainMember[]> }>,
): { scope: ChainScope; copies: Record<string, ChainMember[]> } | undefined {
  for (const parent of parents) {
    const agents = Object.keys(parent.chains)
    if (agents.length === 0) continue
    const copies: Record<string, ChainMember[]> = {}
    for (const agent of agents) {
      const filled = fillChainForNewLayer(parent.chains[agent])
      if (filled !== undefined) copies[agent] = filled
    }
    if (Object.keys(copies).length > 0) return { scope: parent.scope, copies }
  }
  return undefined
}

/**
 * Fill-once at session creation (t68, C1/C5 live finding): EVERY creation
 * path lands in `Session.createNext` — API, TUI, task/pipeline
 * subsessions, org delivery — so the new session layer gets its copies
 * there, once. A layer that already holds chains is left alone; layers
 * born without any parent chain stay empty (one-time backfill on first
 * assignment, never a read walk).
 */
export function fillSessionChains(sessionID: string, opts?: { workspaceID?: string; parentID?: string }): void {
  const target = `session:${sessionID}`
  try {
    Database.use((db) => {
      const existing = db
        .select({ agent: ModelChainTable.agent })
        .from(ModelChainTable)
        .where(eq(ModelChainTable.scope, target))
        .all()
      if (existing.length > 0) return
      const worktree = `worktree:${opts?.workspaceID ?? "default"}`
      const candidates: ChainScope[] = [
        ...(opts?.parentID ? [`session:${opts.parentID}` as ChainScope] : []),
        worktree,
        "global",
      ]
      const parents = candidates.map((scope) => ({ scope, chains: loadScopeChains(scope) }))
      const plan = planSessionFill(parents)
      if (!plan) return
      const now = Date.now()
      for (const [agent, members] of Object.entries(plan.copies)) {
        const data = encode(members)
        db.insert(ModelChainTable)
          .values({ scope: target, agent, data, time_created: now, time_updated: now })
          .onConflictDoNothing()
          .run()
      }
      log.debug("model-chain session filled", { sessionID, from: plan.scope, agents: Object.keys(plan.copies) })
    })
  } catch (cause) {
    storeFailure("fill", target, "*", cause)
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
