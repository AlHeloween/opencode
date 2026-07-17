/**
 * Pure provider-facing system message assembly.
 *
 * Order is cache-sensitive — see AGENTS.md KV Cache Continuity.
 *
 * Layout (stable prefix first, mutable last):
 *   [0] UNIVERSAL_ENV          — immutable forever
 *   [1] tool schemas           — stable per app version
 *   [2] identity + path system — stable per agent + project (skills/env/rules/AGENTS)
 *   [3] mutable tail           — active tools line, session banner, user system
 *
 * NEVER put session IDs, timestamps, or per-turn tool-active lines inside
 * segments [0–2]. Collapse used to join identity+path+banner into one string,
 * so a new session invalidated the entire path/skills block (~20–40k tokens).
 */

export type SystemComposeInput = {
  universalEnv: string
  /** Empty string skips the tool-schemas slot. */
  toolSchemas: string
  /** Reasoning prefix + agent prompt (identity). Stable for agent+model family. */
  identity: string
  /**
   * Path-level system entries from prompt.ts.
   * Non-checkpoint: skills → env → rules → instructions (+ optional structured prompt).
   * Checkpoint: stored systemPrompt including identity at [0]; identity is stripped
   * and replaced by the fresh `identity` argument.
   */
  pathSystem: string[]
  /** Per-turn / per-agent tool availability — mutable, always last. */
  activeToolsLine: string
  /** Session id / provider cache key — mutable, always last. */
  banner: string
  userSystem?: string
  checkpoint: boolean
}

/**
 * Assemble pre-plugin system messages in stable-first order.
 * Does not run plugin transforms — callers apply those by reference after.
 */
export function assembleSystemMessages(input: SystemComposeInput): string[] {
  const system: string[] = [input.universalEnv]
  if (input.toolSchemas) system.push(input.toolSchemas)

  // Stable body: identity + project path system (no session vars).
  const path =
    input.checkpoint && input.pathSystem.length > 0
      ? input.pathSystem.slice(1) // drop stored identity; use fresh `identity`
      : input.pathSystem
  const stableBody = [input.identity, ...(path.length > 0 ? [path.join("\n")] : [])]
    .filter((s) => s.length > 0)
    .join("\n")
  if (stableBody) system.push(stableBody)

  // Mutable tail — session banner, active tools, user system. Always last so
  // prefix KV hits survive across sessions on the same project/agent.
  const mutable: string[] = []
  if (input.activeToolsLine) mutable.push(input.activeToolsLine)
  if (input.banner) mutable.push(input.banner)
  if (!input.checkpoint && input.userSystem) mutable.push(input.userSystem)
  if (mutable.length > 0) system.push(mutable.join("\n"))

  return system
}

/**
 * Collapse for provider cache:
 *   [UNIVERSAL_ENV, toolSchemas, stableBody, mutableTail]
 *
 * When there are only 3 parts already (UE, tools, rest), leave as-is only if
 * `rest` is purely mutable — prefer 4-part layout from assembleSystemMessages.
 * Does NOT merge the last (mutable) segment into the stable body.
 */
export function collapseSystemMessages(system: string[], header: string): string[] {
  if (system.length <= 2 || system[0] !== header) return system

  // assembleSystemMessages produces 3–4 slots:
  //   [UE, tools?, stableBody, mutable?]
  // Keep them separate. Only join accidental middle fragments if a plugin
  // inserted extras between tools and the final mutable segment.
  if (system.length === 3) {
    // [UE, tools|stable, mutable] or [UE, tools, stable+mutable mixed]
    return system
  }
  if (system.length === 4) {
    // [UE, tools, stable, mutable] — ideal
    return system
  }

  // Plugin added parts: [UE, tools, ...middle, lastMutable]
  const second = system[1]!
  const last = system[system.length - 1]!
  const middle = system.slice(2, -1)
  if (middle.length === 0) return [header, second, last]
  return [header, second, middle.join("\n"), last]
}

/** Stable-first path assembly used by prompt.ts (non-checkpoint). */
export function assemblePathSystem(input: {
  skills?: string
  env: string[]
  rules: string[]
  instructions: string[]
}): string[] {
  return [
    ...(input.skills ? [input.skills] : []),
    ...input.env,
    ...input.rules,
    ...input.instructions,
  ]
}
