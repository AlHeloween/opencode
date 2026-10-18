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
import { resolveGlobalHead } from "@/session/global-recents"
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
    /**
     * t87 allowlist (L4 `globalRecents`). Gated at USE in `resolveChainAgentModel`;
     * when the session chain holds no in-list member, the head of this list is
     * assigned instead — one owner edit moves every worktree, no `model.json` touched.
     */
    globalRecents?: string[] | undefined
  },
): ChainAssignment | undefined {
  const load = deps?.load ?? loadChain
  const health = deps?.health ?? chainHealthState()
  const noteUse = deps?.noteUse ?? noteChainUse
  const agent = canonicalIdentity(agentName)
  const chain = load(`session:${sessionID}`, agent)
  const member = resolveChainAgentModel(agent, sessionID, health, { chain, globalRecents: deps?.globalRecents })
  if (!member) {
    const list = deps?.globalRecents
    if (list !== undefined) {
      const head = resolveGlobalHead(list, health)
      if (head) {
        const headKey = memberKey(head)
        const headPrev = noteUse(sessionID, agent, head)
        const note =
          headPrev === undefined
            ? `global-recents head ${headKey} (session chain held no in-list member)`
            : `global-recents head ${headKey} (switch ${headPrev} → ${headKey}; session chain held no in-list member)`
        const headAssignment: ChainAssignment = {
          model: { providerID: head.providerID, modelID: head.modelID },
          note,
        }
        if (head.variant !== undefined) headAssignment.variant = head.variant
        return headAssignment
      }
    }
    return undefined
  }
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
