/**
 * Graph-first gate — the mechanism half of the owner's 2026-10-15 finding:
 * «наши ребятушки совсем не используют codegraph скатываются на list/glob/grep это архи не
 * эффективно». Measured on this host (part table, 7 days, query in
 * plans/2026-10-15_graph-first-read-not-scan.md): scanners 2560 calls / 92 sessions vs organic
 * codegraph ≈1:65 (one self-test session dominates the rest). The kernel G1 rule already says
 * graph-before-scanners — text is ignored, so this is the runtime latch, modeled on
 * stop-check.ts (once-only latch, route text, opt-out env).
 *
 * In a worktree with `.codegraph/`, the FIRST grep/glob/list call of a session that has made no
 * codegraph call is refused ONCE with the route; after any codegraph call, or after that one
 * refusal, scanners run freely. No `.codegraph/` → no effect. Sub-agents included: each session
 * carries its own latch (measured 2026-10-15: sub-agents made 159 scanner calls in 17 sessions).
 *
 * [KV-CACHE SAFE] — runtime gate on tool execution; never touches prompts.
 */
import { existsSync } from "fs"
import path from "path"

/** Opt-out switch: OPENCODE_GRAPH_FIRST=0|false|off|no (the repo's convention — stop-check.ts). */
export const OPT_OUT_ENV = "OPENCODE_GRAPH_FIRST"

/** The scanners the gate covers — the owner's list. */
export const SCANNER_TOOLS = new Set(["grep", "glob", "list"])

type Latch = { codegraph: boolean; refused: boolean }
const latches = new Map<string, Latch>()

function latch(sessionID: string): Latch {
  let state = latches.get(sessionID)
  if (!state) {
    state = { codegraph: false, refused: false }
    latches.set(sessionID, state)
  }
  return state
}

/**
 * True for any codegraph tool name — the MCP prefix (`codegraphcodegraph*`) and the bare name
 * alike. The registry's own normalization: lowercase, strip non-alphanumerics.
 */
export function isCodegraphTool(tool: string): boolean {
  return tool.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith("codegraph")
}

/** True when OPENCODE_GRAPH_FIRST carries the repo's opt-out spelling. */
export function graphFirstDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env[OPT_OUT_ENV] ?? "").trim().toLowerCase()
  return value === "0" || value === "false" || value === "off" || value === "no"
}

/** A completed codegraph call marks the session graph-aware (processor.completeToolCall). */
export function noteToolCall(sessionID: string, tool: string): void {
  if (!isCodegraphTool(tool)) return
  latch(sessionID).codegraph = true
}

/**
 * The host's turn-start graph pre-build (graph-prebuild.ts) counts as the session's codegraph
 * call — the session that just received the graph is never refused by the scanner backstop.
 */
export function markPrebuilt(sessionID: string): void {
  latch(sessionID).codegraph = true
}

export function hasCodegraphDir(worktree: string): boolean {
  return existsSync(path.join(worktree, ".codegraph"))
}

export function graphFirstRoute(tool: string): string {
  return (
    `[graph-first: BLOCKED ${tool}] The graph answers structure before text: ask codegraph first — ` +
    `codegraph_explore "<symbols or question>". grep stays the negative text control after the ` +
    `graph answers. This scanner runs freely from the next call.`
  )
}

/**
 * The gate a scanner tool asks before running. `undefined` = run freely; a hit carries the route
 * text and CONSUMES the once-refusal (the session's next scanner call runs).
 */
export function scannerGate(input: {
  sessionID: string
  tool: string
  worktree: string
  env?: NodeJS.ProcessEnv
}): { message: string } | undefined {
  if (graphFirstDisabled(input.env)) return undefined
  if (!SCANNER_TOOLS.has(input.tool.toLowerCase())) return undefined
  if (!hasCodegraphDir(input.worktree)) return undefined
  const state = latch(input.sessionID)
  if (state.codegraph || state.refused) return undefined
  state.refused = true
  return { message: graphFirstRoute(input.tool) }
}

/** Test hook: drop one session's latch (or all). */
export function resetGraphFirstState(sessionID?: string): void {
  if (sessionID) latches.delete(sessionID)
  else latches.clear()
}
