/**
 * Graph-first reminder — the mechanism half of the owner's 2026-10-15 finding:
 * «наши ребятушки совсем не используют codegraph скатываются на list/glob/grep это архи не
 * эффективно». Measured on this host (part table, 7 days, query in
 * plans/2026-10-15_graph-first-read-not-scan.md): scanners 2560 calls / 92 sessions vs organic
 * codegraph ≈1:65 (one self-test session dominates the rest). The kernel G1 rule routes by
 * layer (t90, owner 2026-10-19: «мы привязали codegraph к греп как правило - это глупо»):
 * text → grep, files by name → glob/list, structure → codegraph.
 *
 * Owner 2026-10-19: «не надо так требовать codegraph, это должно быть обычным системным
 * напоминанием, а не enforcement.» So the gate no longer refuses: the FIRST grep/glob/list
 * call of a session with no codegraph call RUNS and carries a one-line layer-routing note;
 * the next scanner call carries none. Nothing is ever thrown.
 *
 * In a worktree with `.codegraph/`, the FIRST grep/glob/list call of a session that has made no
 * codegraph call runs WITH the note; after any codegraph call, or after that one noted
 * call, scanners run without it. No `.codegraph/` → no effect. A path outside the worktree
 * gets no note (the graph cannot answer another project or a docs folder elsewhere) and does
 * not consume the latch. Sub-agents included: each session carries its own latch
 * (measured 2026-10-15: sub-agents made 159 scanner calls in 17 sessions).
 *
 * [KV-CACHE SAFE] — runtime gate on tool execution; never touches prompts.
 */
import { existsSync } from "fs"
import path from "path"
import { configValue } from "@opencode-ai/core/flag/flag"

/** Opt-out switch: OPENCODE_GRAPH_FIRST=0|false|off|no (the repo's convention — stop-check.ts). */
export const OPT_OUT_ENV = "OPENCODE_GRAPH_FIRST"

/** The scanners the gate covers — the owner's list. */
export const SCANNER_TOOLS = new Set(["grep", "glob", "list"])

type Latch = { codegraph: boolean; noted: boolean }
const latches = new Map<string, Latch>()

function latch(sessionID: string): Latch {
  let state = latches.get(sessionID)
  if (!state) {
    state = { codegraph: false, noted: false }
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

/** Disabled-state with priority env > config > default-on (t76-minimum). */
export function graphFirstDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[OPT_OUT_ENV]
  if (raw !== undefined && raw.trim() !== "") {
    const value = raw.trim().toLowerCase()
    return value === "0" || value === "false" || value === "off" || value === "no"
  }
  const cfg = configValue(OPT_OUT_ENV)
  if (typeof cfg === "boolean") return !cfg
  return false
}

/** A completed codegraph call marks the session graph-aware (processor.completeToolCall). */
export function noteToolCall(sessionID: string, tool: string): void {
  if (!isCodegraphTool(tool)) return
  latch(sessionID).codegraph = true
}

/**
 * The host's turn-start graph pre-build (graph-prebuild.ts) counts as the session's codegraph
 * call — the session that just received the graph runs scanners without the reminder note.
 */
export function markPrebuilt(sessionID: string): void {
  latch(sessionID).codegraph = true
}

export function hasCodegraphDir(worktree: string): boolean {
  return existsSync(path.join(worktree, ".codegraph"))
}

/** True when the asked path lives outside the worktree — another project, a docs folder elsewhere. */
export function isOutsideWorktree(worktree: string, target: string): boolean {
  const rel = path.relative(path.resolve(worktree), path.resolve(target))
  if (rel === "") return false
  if (path.isAbsolute(rel)) return true
  return rel === ".." || rel.startsWith(`..${path.sep}`)
}

export function graphFirstNote(_tool: string): string {
  return `note: structure, callers or impact \u2192 codegraph_explore; text \u2192 grep; files by name \u2192 glob/list.`
}

/**
 * The note a scanner tool appends to its normally running result. `undefined` = run without a
 * note; a hit carries the note text and CONSUMES the once-per-session note (the session's next
 * scanner call runs note-free).
 */
export function scannerGate(input: {
  sessionID: string
  tool: string
  worktree: string
  target?: string
  env?: NodeJS.ProcessEnv
}): { note: string } | undefined {
  if (graphFirstDisabled(input.env)) return undefined
  if (!SCANNER_TOOLS.has(input.tool.toLowerCase())) return undefined
  if (!hasCodegraphDir(input.worktree)) return undefined
  if (input.target !== undefined && isOutsideWorktree(input.worktree, input.target)) return undefined
  const state = latch(input.sessionID)
  if (state.codegraph || state.noted) return undefined
  state.noted = true
  return { note: graphFirstNote(input.tool) }
}

/** Test hook: drop one session's latch (or all). */
export function resetGraphFirstState(sessionID?: string): void {
  if (sessionID) latches.delete(sessionID)
  else latches.clear()
}
