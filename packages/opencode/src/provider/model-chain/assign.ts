/**
 * Chain assignment for dispatched prompts (t68, C5 wiring core).
 *
 * A prompt WITHOUT an explicit model resolves through the session layer's
 * chain: `loadChain(session-scope)` → `resolveChainAgentModel` (first UP).
 * An explicit model never touches the chain. An empty session layer is a
 * fill defect — the caller falls through to the legacy path, never to a
 * parent.
 *
 * A mid-session switch is a VISIBLE note, not a silent swap: `note`
 * names the previous member, the new one, and the recorded reason.
 * The note is served to the TUI/web form through `GET /chain` (per-member
 * status + reason) and the server log; an in-session rendered banner
 * needs a new event type and rides C6. The footer already shows which
 * model actually answered.
 */
import { memberKey } from "./chain"
import { canonicalIdentity } from "@/session/mode-identity"
import { chainHealthState, noteChainUse } from "./health-registry"
import { loadChain } from "./store"
import { resolveChainAgentModel } from "@/session/session-settings"
import type { ChainHealth, ChainMember } from "./chain"

export interface ChainAssignment {
  model: { providerID: string; modelID: string }
  variant?: string
  note: string
}

export function assignChainModel(
  sessionID: string,
  agentName: string,
  deps?: {
    load?: (scope: string, agent: string) => ChainMember[] | undefined
    health?: ReadonlyMap<string, ChainHealth>
    noteUse?: (sessionID: string, agentName: string, member: ChainMember) => string | undefined
  },
): ChainAssignment | undefined {
  const load = deps?.load ?? loadChain
  const health = deps?.health ?? chainHealthState()
  const noteUse = deps?.noteUse ?? noteChainUse
  const agent = canonicalIdentity(agentName)
  const chain = load(`session:${sessionID}`, agent)
  const member = resolveChainAgentModel(agent, sessionID, health, { chain })
  if (!member) return undefined
  const key = memberKey(member)
  const previous = noteUse(sessionID, agent, member)
  const reason = previous ? health.get(previous)?.reason : undefined
  const note =
    previous === undefined
      ? `chain assign ${key}`
      : `chain switch ${previous} → ${key}${reason ? ` (${reason})` : ""}`
  const assignment: ChainAssignment = {
    model: { providerID: member.providerID, modelID: member.modelID },
    note,
  }
  if (member.variant !== undefined) assignment.variant = member.variant
  return assignment
}
