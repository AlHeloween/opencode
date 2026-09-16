/**
 * One configuration scope shared by every settings surface in the TUI.
 *
 * Before this module each dialog carried its own notion of "where does a save
 * land": `/agents` defaulted to session, `/routing` to global, `/settings` to
 * worktree and knew nothing about session at all. None of them remembered the
 * choice — `DialogAgent` is opened bare from app.tsx, so every `/agents` reset
 * the scope to session, and `DialogSettings` kept it in a module variable that
 * died with the process (2026-09-16, Alexander: "постоянно приходится
 * выбирать... почему не может быть унифицированного сохранения").
 *
 * The selected scope lives in the TUI KV store (`Global.Path.state/kv.json`,
 * per worktree), so it survives a restart and every dialog reads the same
 * value. `/agents` is the hub that sets it; the rest follow.
 */
export type ConfigScope = "global" | "worktree" | "session"

/** ←/→ order in every scope selector: widest layer first. */
export const SCOPE_ORDER: readonly ConfigScope[] = ["global", "worktree", "session"]

/** KV key holding the last scope the user selected. */
export const SCOPE_KV_KEY = "config.scope"

const SCOPE_SET = new Set<string>(SCOPE_ORDER)

/**
 * The layer a scope falls through to when it holds nothing of its own.
 * Mirrors the resolution chain in `local.forAgent`: session → worktree →
 * global → built-in default.
 */
export function parentScope(scope: ConfigScope): ConfigScope | undefined {
  if (scope === "session") return "worktree"
  if (scope === "worktree") return "global"
  return undefined
}

/**
 * Validate a value read back from KV. kv.json is shared across processes and
 * hand-editable, so a stale or garbage value must degrade to the fallback
 * rather than render a dialog with an unknown scope.
 */
export function readScope(raw: unknown, fallback: ConfigScope = "session"): ConfigScope {
  return typeof raw === "string" && SCOPE_SET.has(raw) ? (raw as ConfigScope) : fallback
}

/** Cycle within a dialog's supported scopes; wraps at both ends. */
export function cycleScope(
  scope: ConfigScope,
  direction: 1 | -1,
  supported: readonly ConfigScope[] = SCOPE_ORDER,
): ConfigScope {
  if (supported.length === 0) return scope
  const index = supported.indexOf(scope)
  // An unsupported current scope enters at the first supported layer rather
  // than at index -1 + direction, which silently skipped a layer.
  if (index === -1) return supported[0]!
  return supported[(index + direction + supported.length) % supported.length]!
}

/**
 * Narrow the shared scope to what a given dialog can actually write.
 * `/settings` writes config files only — there is no session-scoped config
 * layer — so a shared scope of "session" must display as its parent instead of
 * silently writing somewhere the user did not pick.
 */
export function coerceScope(scope: ConfigScope, supported: readonly ConfigScope[]): ConfigScope {
  if (supported.includes(scope)) return scope
  let current: ConfigScope | undefined = scope
  while ((current = parentScope(current))) {
    if (supported.includes(current)) return current
  }
  return supported[0] ?? scope
}

/**
 * Footer text for a layer that holds no value of its own. Names the layer the
 * value actually comes from instead of the previous bare "not set in session",
 * which left the inheritance invisible.
 */
export function inheritLabel(scope: ConfigScope): string {
  const parent = parentScope(scope)
  return parent ? `inherits from ${parent}` : "no config default"
}
