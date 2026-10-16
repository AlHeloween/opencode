/**
 * In-memory failover state for model chains (t68).
 *
 * ONE process, ONE registry: per-member UP/DOWN (written by failover and
 * the 10-minute probe) plus the last member used per (session, agent) so
 * a mid-session switch is observable. Persistence of the CHAINS lives in
 * `store.ts` (`model_chain` table); this registry holds only the volatile
 * signal — a restart re-probes, it never inherits a verdict.
 */
import { memberKey } from "./chain"
import type { ChainHealth, ChainMember } from "./chain"

const health = new Map<string, ChainHealth>()
const lastUsed = new Map<string, string>()

function lastUsedKey(sessionID: string, agentName: string): string {
  return `${sessionID}\n${agentName}`
}

/** Live registry: the failover loop and the 10-minute probe mutate it. Readers take `ReadonlyMap` views themselves. */
export function chainHealthState(): Map<string, ChainHealth> {
  return health
}

export function markChainDown(member: ChainMember, now: number, reason: string): void {
  health.set(memberKey(member), { status: "DOWN", downAt: now, reason })
}

export function markChainUp(member: ChainMember): void {
  health.set(memberKey(member), { status: "UP" })
}

/**
 * Record which member served a session's agent. Returns the previous
 * member key, or `undefined` on first use — the caller turns a change
 * into the visible switch note.
 */
export function noteChainUse(sessionID: string, agentName: string, member: ChainMember): string | undefined {
  const key = memberKey(member)
  const previous = lastUsed.get(lastUsedKey(sessionID, agentName))
  lastUsed.set(lastUsedKey(sessionID, agentName), key)
  if (previous === key) return undefined
  return previous
}
