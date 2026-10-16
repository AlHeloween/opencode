/**
 * Explicit ordered model chain (t68).
 *
 * The chain is the ordered form of "recents": per agent AND scope
 * (global / worktree / session, filled not resolved) the user names
 * `[primary, backup1, backup2…]`. Failover walks this order and never
 * invents a model outside it.
 *
 * Persistence lives in the EXISTING shapes the TUI already writes
 * (`model.json` worktree state, session `.jsonc`, global config) — this
 * module holds the pure order/fill/selection helpers so they are pinned
 * by tests. FS wiring reuses the TUI server path (never a new JSON file,
 * never a behind-the-back edit).
 */

export interface ChainMember {
  providerID: string
  modelID: string
  variant?: string
}

export type MemberStatus = "UP" | "DOWN"

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
 * Fill, never resolve: session wins, then worktree, then global.
 * Each layer is an explicit chain or absent — layers are never merged,
 * so the order the user named stays the order failover walks.
 */
export function fillChain(
  sessionChain: ChainMember[] | undefined,
  worktreeChain: ChainMember[] | undefined,
  globalChain: ChainMember[] | undefined,
): ChainMember[] | undefined {
  if (sessionChain !== undefined && sessionChain.length > 0) return sessionChain
  if (worktreeChain !== undefined && worktreeChain.length > 0) return worktreeChain
  if (globalChain !== undefined && globalChain.length > 0) return globalChain
  return undefined
}

/** First UP member in chain order. Missing health reads as UP. */
export function firstUp(chain: ChainMember[], health: ReadonlyMap<string, ChainHealth>): ChainMember | undefined {
  for (const member of chain) {
    if (health.get(memberKey(member))?.status === "DOWN") continue
    return member
  }
  return undefined
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
