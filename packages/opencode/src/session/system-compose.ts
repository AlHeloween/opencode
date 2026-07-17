/**
 * Pure provider-facing system message assembly.
 *
 * Order is cache-sensitive — see AGENTS.md KV Cache Continuity.
 * Collapse keeps system[0] (UNIVERSAL_ENV) and system[1] (tool schemas)
 * as the stable prefix; everything from index 2+ becomes the mutable tail.
 */

export type SystemComposeInput = {
  universalEnv: string
  /** Empty string skips the tool-schemas slot. */
  toolSchemas: string
  /** Reasoning prefix + agent prompt (identity). Always re-derived each turn. */
  identity: string
  /**
   * Path-level system entries from prompt.ts.
   * Non-checkpoint: skills → env → rules → instructions (+ optional structured prompt).
   * Checkpoint: stored systemPrompt including identity at [0]; identity is stripped
   * and replaced by the fresh `identity` argument.
   */
  pathSystem: string[]
  activeToolsLine: string
  banner: string
  userSystem?: string
  checkpoint: boolean
}

/**
 * Assemble pre-plugin system messages in stable order.
 * Does not run plugin transforms — callers apply those by reference after.
 */
export function assembleSystemMessages(input: SystemComposeInput): string[] {
  const system: string[] = [input.universalEnv]
  if (input.toolSchemas) system.push(input.toolSchemas)

  system.push(input.identity)

  // Checkpoint path: stored systemPrompt[0] is the prior identity; drop it so
  // the freshly computed identity is the only identity prefix.
  const path = input.checkpoint && input.pathSystem.length > 0
    ? input.pathSystem.slice(1)
    : input.pathSystem
  if (path.length > 0) system.push(path.join("\n"))

  system.push(input.activeToolsLine)
  system.push(input.banner)
  if (!input.checkpoint && input.userSystem) system.push(input.userSystem)
  return system
}

/**
 * Collapse to [UNIVERSAL_ENV, toolSchemas|identity..., tail] form used for
 * provider cache: keep first two slots when present, join the rest.
 *
 * When tool schemas are empty, identity is system[1] and becomes part of the
 * "second" cacheable slot only if we still have 3+ parts — same algorithm as
 * historical llm.ts: preserve [0] and [1], join [2+].
 */
export function collapseSystemMessages(system: string[], header: string): string[] {
  if (system.length <= 2 || system[0] !== header) return system
  const second = system[1]!
  const tail = system.slice(2)
  return [header, second, tail.join("\n")]
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
