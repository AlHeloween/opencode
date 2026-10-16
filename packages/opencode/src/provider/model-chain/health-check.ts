/**
 * 10-minute chain health check (t68).
 *
 * Runs OFF the request path on the owner cadence. Each DOWN member gets
 * one cheap probe; a member that answers returns UP and the chain
 * restores its order. A member that stays DOWN is re-armed for the next
 * check (downAt = now), so it is never retried before its time.
 *
 * The probe is a DIRECT provider call (or an ephemeral non-resumable
 * path) with zero tools and zero sessions in the robots' host — measured
 * 2026-10-16, probe sessions got revived and stole plan boxes. This
 * module enforces that by construction: it only calls the injected
 * `probe` callback. Production wires a direct call; `prompt_async`
 * never appears in that path (pinned by test).
 */
import { HEALTH_CHECK_INTERVAL_MS, isProbeDue, markUp, memberKey } from "./chain"
import type { ChainHealth, ChainMember } from "./chain"

export interface ProbeReport {
  probed: string[]
  revived: string[]
}

export async function probeDownMembers(options: {
  chain: ChainMember[]
  health: Map<string, ChainHealth>
  now: number
  /** Direct provider probe. Must create no sessions and carry no tools. */
  probe: (member: ChainMember) => Promise<boolean>
  onUp?: (member: ChainMember) => void
}): Promise<ProbeReport> {
  const probed: string[] = []
  const revived: string[] = []
  for (const member of options.chain) {
    const key = memberKey(member)
    const entry = options.health.get(key)
    if (!isProbeDue(entry, options.now)) continue
    probed.push(key)
    let ok = false
    try {
      ok = await options.probe(member)
    } catch {
      ok = false
    }
    if (ok) {
      markUp(options.health, member)
      revived.push(key)
      options.onUp?.(member)
      continue
    }
    options.health.set(key, { status: "DOWN", downAt: options.now, reason: entry?.reason ?? "probe failed" })
  }
  return { probed, revived }
}

export { HEALTH_CHECK_INTERVAL_MS }
