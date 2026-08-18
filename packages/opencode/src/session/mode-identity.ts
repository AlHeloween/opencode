/**
 * Canonical identity ids (*_mode / *_agent) and mode-transition helpers.
 * Keeps planexit/reasoning* switch paths aligned with TUI agent changes.
 */

/** Short legacy names → canonical identity (migration). */
const IDENTITY_ALIASES: Record<string, string> = {
  build: "build_mode",
  plan: "plan_mode",
  reasoning: "reasoning_mode",
  coder: "coder_agent",
  explore: "explorer_agent",
  explorer: "explorer_agent",
  researcher: "researcher_agent",
  general: "general_agent",
  media: "media_agent",
  orchestrator: "orchestrator_agent",
  title: "title_agent",
}

export function canonicalIdentity(name: string): string {
  return IDENTITY_ALIASES[name] ?? name
}

/** Primary mode ids that use conversation-tail transition text. */
export function isPrimaryModeIdentity(name: string): boolean {
  const id = canonicalIdentity(name)
  return id === "build_mode" || id === "plan_mode" || id === "reasoning_mode"
}
