/**
 * Explicit ordered model chain (t68).
 *
 * The chain is the ordered form of "recents": per agent AND scope
 * (global / worktree / session) the user names `[primary, backup1, backup2…]`.
 * Failover walks this order and never invents a model outside it.
 *
 * FILL, never resolve (AGENTS.md § Storage Paradigm, rule 4): a layer that
 * comes into existence gets its chain COPIED from the layer above exactly
 * once (`fillChainForNewLayer`); every later read addresses ONE key
 * (`readChainLayer`). There is no parent walk on read — an empty layer is
 * a fill defect (one-time backfill, then lookup), never a silent hole.
 *
 * Persistence is a key namespace in the relational plane
 * (`model_chain` table, `chain.sql.ts`, `store.ts`) — the same
 * single-row-blob split `session_epistemic` uses. LMDB is not deployed yet
 * (`learned-facts.ts:17`, `epistemic-store.ts:10-12` — measured 2026-10-16,
 * not even in package.json); when the fast plane lands, this namespace
 * moves and the table goes with it. Never a new JSON file, never a write
 * behind the TUI's back.
 */

export interface ChainMember {
  providerID: string
  modelID: string
  variant?: string
}

export type MemberStatus = "UP" | "DOWN"

/** Health as the UI must render it: absent oracle reads as `unknown`, never blank. */
export type ChainDisplayStatus = "UP" | "DOWN" | "unknown"

/** Layer scope: global, one worktree, or one session. */
export type ChainScope = string

export interface ChainHealth {
  status: MemberStatus
  downAt?: number
  reason?: string
}

/** Owner cadence: the chain is re-checked every 10 minutes, off the request path. */
export const HEALTH_CHECK_INTERVAL_MS = 10 * 60 * 1000

export function memberKey(member: ChainMember): string {
  return `${member.providerID}/${member.modelID}`
}

function isValidMember(entry: unknown): entry is ChainMember {
  if (typeof entry !== "object" || entry === null) return false
  const value = entry as Record<string, unknown>
  return typeof value.providerID === "string" && value.providerID.length > 0 && typeof value.modelID === "string" && value.modelID.length > 0
}

/** Keep the explicit user order; drop empties. Never re-sorts, never fills. */
export function validateChain(chain: unknown): ChainMember[] {
  if (!Array.isArray(chain)) return []
  const members: ChainMember[] = []
  for (const entry of chain) {
    if (!isValidMember(entry)) continue
    const member: ChainMember = { providerID: entry.providerID, modelID: entry.modelID }
    if (typeof entry.variant === "string" && entry.variant.length > 0) member.variant = entry.variant
    members.push(member)
  }
  return members
}

/**
 * Copy the parent layer's chain into a layer that comes into existence.
 * Runs exactly once per layer (creation, or one-time backfill for layers
 * born before chains); afterwards the layer owns its copy and the parent
 * is never consulted again. `undefined` stays `undefined` — an unfilled
 * layer is a defect to backfill, not a value to inherit on read.
 */
export function fillChainForNewLayer(parent: ChainMember[] | undefined): ChainMember[] | undefined {
  if (parent === undefined || parent.length === 0) return undefined
  return parent.map((member) => ({ ...member }))
}

/**
 * Read ONE layer's key. Validates and returns the stored chain, or
 * `undefined` when the layer holds nothing — no parent is consulted.
 */
export function readChainLayer(stored: unknown): ChainMember[] | undefined {
  const members = validateChain(stored)
  if (members.length === 0) return undefined
  return members
}

/** True when the layer holds no chain and is due its one-time backfill. */
export function shouldBackfill(stored: ChainMember[] | undefined): boolean {
  return stored === undefined || stored.length === 0
}

/** Storage key for one agent's chain in one layer: `session:<id>:agent:<name>:chain`. */
export function chainKey(scope: ChainScope, agentName: string): string {
  return `${scope}:agent:${agentName}:chain`
}

/**
 * First UP member in chain order. Missing health reads as UP for ROUTING
 * (a member with no signal is tried, not skipped) — for DISPLAY use
 * `displayHealth`, where the same absence reads as `unknown`.
 */
export function firstUp(chain: ChainMember[], health: ReadonlyMap<string, ChainHealth>): ChainMember | undefined {
  for (const member of chain) {
    if (health.get(memberKey(member))?.status === "DOWN") continue
    return member
  }
  return undefined
}

/**
 * Health for DISPLAY: a member with no recorded signal reads as `unknown`
 * (absence of an oracle reads as FALSE to the user — never blank, never
 * silently UP). Routing (`firstUp`) tries it; the screen says `unknown`.
 */
export function displayHealth(member: ChainMember, health: ReadonlyMap<string, ChainHealth>): ChainDisplayStatus {
  const entry = health.get(memberKey(member))
  if (entry === undefined) return "unknown"
  return entry.status
}

/** True when a DOWN member is due its 10-minute probe. */
export function isProbeDue(entry: ChainHealth | undefined, now: number): boolean {
  if (entry === undefined || entry.status !== "DOWN") return false
  return now - (entry.downAt ?? 0) >= HEALTH_CHECK_INTERVAL_MS
}

export function markDown(health: Map<string, ChainHealth>, member: ChainMember, now: number, reason: string): void {
  health.set(memberKey(member), { status: "DOWN", downAt: now, reason })
}

export function markUp(health: Map<string, ChainHealth>, member: ChainMember): void {
  health.set(memberKey(member), { status: "UP" })
}
