import type { Message } from "@opencode-ai/sdk/v2/client"
import type { LastProtocol, ProtocolCurrent } from "../layout/protocol-facts"
import { protocolLabel, protocolPinned, protocolRow } from "../layout/protocol-facts"

/**
 * Session-scoped protocol cell inputs (t59 W3).
 *
 * The TUI derives the same contract in
 * `sidebar/context.tsx:384-414`: the current turn from the last assistant
 * message (`requestID = parentID`), the measured rung + pin from the
 * `gateway.protocol.selected` facts, the configured mode from the model's
 * options (default `auto`).
 *
 * Web gaps, stated plainly: the model's configured `options.protocol` has no
 * web-reachable source (the web provider list carries no options — verified),
 * so `configured` stays `undefined` and the cell renders the honest `auto(…)`
 * form (the default policy IS auto — `session/llm.ts` falls through to it).
 * The living-connection badge is NOT rendered here: its source
 * (`globalThis.__gatewayLiveStatus`, written by the server process in
 * `gateway/mod.ts:131-142`) is unreachable from the browser. Rendering `○`
 * without a source would assert "disconnected" falsely — no source means no
 * badge, and the cell still never blanks.
 */

type AssistantLike = Extract<Message, { role: "assistant" }>

export function protocolCurrentFromMessages(
  sessionID: string,
  messages: ReadonlyArray<Message | { role?: string }> | undefined,
): ProtocolCurrent | undefined {
  if (!messages) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Partial<AssistantLike> & { role?: string }
    if (m?.role !== "assistant") continue
    if (m.sessionID !== undefined && m.sessionID !== sessionID) continue
    if (typeof m.parentID !== "string" || typeof m.providerID !== "string" || typeof m.modelID !== "string") return undefined
    if (typeof m.time?.created !== "number") return undefined
    return {
      requestID: m.parentID,
      sessionID,
      providerID: m.providerID,
      modelID: m.modelID,
      assistantCreatedAt: m.time.created,
    }
  }
  return undefined
}

export function describeProtocolCell(input: {
  facts: Record<string, LastProtocol>
  current: ProtocolCurrent | undefined
  configured?: string | undefined
}): { label: string } {
  if (!input.current) return { label: protocolLabel(input.configured, undefined) }
  const resolved = protocolRow(input.facts, input.current)
  const pinned = protocolPinned(input.facts, input.current)
  return { label: protocolLabel(input.configured, resolved === "unknown" ? undefined : resolved, pinned) }
}
