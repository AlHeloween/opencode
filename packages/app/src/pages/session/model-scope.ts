/**
 * Scope selection for the web model dialog (t59 W4).
 *
 * The TUI offers global/worktree/session (`config-scope.ts`, KV
 * `SCOPE_KV_KEY`); the worktree layer for per-agent model selection is
 * `model.json`, which has no server route — so the web offers the two layers
 * it can actually write: session (via `useLocal()`) and global (via
 * `global.config.update`, the same route the TUI uses). Offering worktree
 * here would be a surface that lies about being one.
 */

export type WebModelScope = "session" | "global"

export const WEB_SCOPE_ORDER: readonly WebModelScope[] = ["session", "global"]

const SCOPE_SET = new Set<string>(WEB_SCOPE_ORDER)

export function readScope(raw: unknown, fallback: WebModelScope = "session"): WebModelScope {
  return typeof raw === "string" && SCOPE_SET.has(raw) ? (raw as WebModelScope) : fallback
}

/**
 * The layers the dialog may offer. Session needs an OPEN session — with none,
 * only global is offered (a session write with nowhere to land is the exact
 * failure the TUI guards in `availableScopes`).
 */
export function availableScopes(sessionAvailable: boolean): readonly WebModelScope[] {
  return sessionAvailable ? WEB_SCOPE_ORDER : (["global"] as const)
}
