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
  /** Reasoning prefix (reasoning.txt). MOST STABLE — goes first in identity block. */
  reasoningPrefix: string
  /**
   * ALGORITHM_CARD (algorithm_card.txt) — commented Python routes bound to kernel symbols.
   * Immediately after reasoning inside the identity block. Empty string skips.
   */
  algorithmCard?: string
  /** Kernel file (opencode_prompts_kernel.txt). Stable per app version. */
  kernel: string
  /** Agent-specific prompt (coder.txt / explore.txt / orchestrator.txt). */
  agentPrompt: string
  /**
   * Path-level system entries from prompt.ts.
   * Non-checkpoint: rules → skills → env → instructions (+ optional structured prompt).
   * Checkpoint: stored systemPrompt including identity at [0]; identity is stripped
   * and replaced by the fresh identity components.
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

  // system[2]: Identity + Path System (ordered by mutability level)
  // Required order: reasoning → ALGORITHM_CARD → kernel → rules → skills → env → agentPrompt → instructions
  // Stable prefix: reasoning → card → kernel (MOST STABLE)
  // Tool schemas stay slot [1] for app-version cache; card is first *route* in identity.
  const stablePrefix = [
    input.reasoningPrefix,
    input.algorithmCard ?? "",
    input.kernel,
  ].filter((s) => s.length > 0)

  // Path system: rules → skills → env → instructions
  const path =
    input.checkpoint && input.pathSystem.length > 0
      ? input.pathSystem.slice(1) // drop stored identity prefix
      : input.pathSystem

  // Agent prompt goes after all path elements (rules/skills/env) but before instructions.
  // If path has instructions (last element), insert agentPrompt before it.
  // Otherwise, append agentPrompt after all path elements.
  let stableBodyParts: string[]
  if (input.agentPrompt) {
    if (path.length > 0) {
      // Insert agentPrompt before the last element (instructions) if there are multiple elements,
      // or after the single element if path has only one element.
      const allButLast = path.slice(0, -1)
      const last = path.slice(-1)
      stableBodyParts = [...stablePrefix, ...allButLast, input.agentPrompt, ...last]
    } else {
      stableBodyParts = [...stablePrefix, input.agentPrompt]
    }
  } else {
    stableBodyParts = [...stablePrefix, ...path]
  }

  const stableBody = stableBodyParts
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
    ...input.rules,                          // Rules first (more stable)
    ...(input.skills ? [input.skills] : []), // Skills after rules
    ...input.env,                            // Environment metadata
    ...input.instructions,                   // Instructions last (most mutable)
  ]
}

/**
 * Validate system message ordering invariants for KV cache continuity.
 * Checks that the assembled system messages follow the required mutability order:
 *   reasoning → ALGORITHM_CARD → kernel → rules → skills → env → agentPrompt → instructions
 *
 * Logs a warning if invariants are violated (development/debugging aid).
 * Returns true if order is valid, false otherwise.
 */
export function validateSystemOrder(system: string[]): boolean {
  if (system.length < 3) return true // Nothing to validate

  const fullText = system.join("\n")

  // Check key ordering invariants
  // Marker must match reasoning.txt header (lean protocol, not v3 essay)
  const reasoningIdx = fullText.indexOf("REASONING PROTOCOL")
  const algorithmIdx = fullText.indexOf("ALGORITHM_CARD")
  const kernelIdx = fullText.indexOf("PROMPT_ABI")
  const agentIdx = fullText.indexOf("You are a coding assistant")

  // Reasoning must come before kernel
  if (reasoningIdx >= 0 && kernelIdx >= 0 && reasoningIdx > kernelIdx) {
    console.warn("bug: system order violation — reasoning after kernel")
    return false
  }

  // ALGORITHM_CARD must sit between reasoning and kernel when present
  if (algorithmIdx >= 0) {
    if (reasoningIdx >= 0 && algorithmIdx < reasoningIdx) {
      console.warn("bug: system order violation — ALGORITHM_CARD before reasoning")
      return false
    }
    if (kernelIdx >= 0 && algorithmIdx > kernelIdx) {
      console.warn("bug: system order violation — ALGORITHM_CARD after kernel")
      return false
    }
  }

  // Kernel must come before agent prompt (if agent prompt exists in stable body)
  if (kernelIdx >= 0 && agentIdx >= 0 && kernelIdx > agentIdx) {
    // Only warn if agentIdx is in the stable body (system[2]), not in mutable tail
    const stableBody = system.slice(0, 3).join("\n")
    if (stableBody.indexOf("You are a coding assistant") >= 0) {
      console.warn("bug: system order violation — kernel after agent prompt in stable body")
      return false
    }
  }

  return true
}
