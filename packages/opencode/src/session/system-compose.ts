/**
 * Pure provider-facing system message assembly.
 *
 * Order is cache-sensitive — see AGENTS.md KV Cache Continuity.
 *
 * Layout (stable prefix first, mutable last):
 *   [0] UNIVERSAL_ENV            — immutable forever
 *   [1] stable identity prefix   — reasoning → ALGORITHM_CARD → kernel (MOST STABLE)
 *   [2] tool schemas             — stable per app version
 *   [3] path system              — rules → skills → env → instructions (NO agent role)
 *   [4] mutable tail             — session banner, user system (optional)
 *
 * Reasoning moved before tool schemas so the model sees how to think before
 * learning what tools are available — protocol-first, tools-second.
 *
 * Agent/role instructions are conversation notifies (synthetic user parts), not
 * system-prefix bytes — so explore/coder/plan/reasoning share one tool schema
 * and path body. NEVER put session IDs, timestamps, per-agent tool lists, or
 * agent.prompt inside segments [0–3].
 */

export type SystemComposeInput = {
  universalEnv: string
  /** Empty string skips the tool-schemas slot. */
  toolSchemas: string
  /** Reasoning prefix (reasoning.txt). MOST STABLE — slot [1], before tool schemas. */
  reasoningPrefix: string
  /**
   * ALGORITHM_CARD (algorithm_card.txt) — commented Python routes bound to kernel symbols.
   * Immediately after reasoning inside the identity block. Empty string skips.
   */
  algorithmCard?: string
  /** Kernel file (prompts_kernel.txt). Stable per app version. */
  kernel: string
  /**
   * @deprecated Prefer conversation role notify. Kept optional for callers;
   * if set, lands in the **mutable tail only** (never stable path body).
   */
  agentPrompt: string
  /**
   * Path-level system entries from prompt.ts.
   * Non-checkpoint: rules → skills → env → instructions (+ optional structured prompt).
   * Checkpoint: stored systemPrompt including identity at [0]; identity is stripped
   * and replaced by the fresh identity components.
   */
  pathSystem: string[]
  /**
   * @deprecated Per-agent active/inactive tool lines break shared KV. Prefer empty.
   * If set, mutable tail only.
   */
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

  // system[1]: Stable identity prefix — reasoning → ALGORITHM_CARD → kernel
  // Goes BEFORE tool schemas: model sees how to think, then what tools exist.
  // Required order: reasoning → ALGORITHM_CARD → kernel (MOST STABLE first)
  const stablePrefix = [
    input.reasoningPrefix,
    input.algorithmCard ?? "",
    input.kernel,
  ].filter((s) => s.length > 0)
  if (stablePrefix.length > 0) system.push(stablePrefix.join("\n"))

  // system[2]: Tool schemas — stable per app version
  if (input.toolSchemas) system.push(input.toolSchemas)

  // system[3]: Path system only (rules → skills → env → instructions).
  // Agent role is NOT here — conversation notify keeps path body shared.
  const path =
    input.checkpoint && input.pathSystem.length > 0
      ? input.pathSystem.slice(1) // drop stored identity prefix
      : input.pathSystem

  const stableBody = path.filter((s) => s.length > 0).join("\n")
  if (stableBody) system.push(stableBody)

  // Mutable tail — never agent tool lists that differ by role.
  // Optional agentPrompt (legacy) only in tail if callers still pass it.
  const mutable: string[] = []
  if (input.activeToolsLine) mutable.push(input.activeToolsLine)
  if (input.agentPrompt) mutable.push(input.agentPrompt)
  if (input.banner) mutable.push(input.banner)
  if (!input.checkpoint && input.userSystem) mutable.push(input.userSystem)
  if (mutable.length > 0) system.push(mutable.join("\n"))

  return system
}

/**
 * Collapse for provider cache:
 *   [UNIVERSAL_ENV, stablePrefix?, toolSchemas, pathBody, mutableTail]
 *
 * When there are only 3 parts already (UE, tools, rest), leave as-is only if
 * `rest` is purely mutable — prefer 5-part layout from assembleSystemMessages.
 * Does NOT merge the last (mutable) segment into the stable body.
 */
export function collapseSystemMessages(system: string[], header: string): string[] {
  if (system.length <= 2 || system[0] !== header) return system

  // assembleSystemMessages produces 3–5 slots:
  //   [UE, stablePrefix?, tools?, pathBody, mutable?]
  // Keep them separate. Only join accidental middle fragments if a plugin
  // inserted extras between tools and the final mutable segment.
  if (system.length <= 5) {
    return system
  }

  // Plugin added parts: [UE, stablePrefix?, tools?, ...middle, lastMutable]
  const second = system[1]!
  const third = system.length > 3 ? system[2]! : undefined
  const last = system[system.length - 1]!
  const middle = system.slice(third ? 3 : 2, -1)
  if (middle.length === 0) return system.length === 4
    ? [header, second, third!, last]
    : [header, second, last]
  return system.length === 4
    ? [header, second, middle.join("\n"), last]
    : [header, second, third!, middle.join("\n"), last]
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
