/**
 * Short-lived permission-ask cache for shell tools.
 *
 * Keyed by shell type + sorted normalized patterns. Shared so Session /
 * Permission rule changes can invalidate without importing bash.ts
 * (avoids heavy tree-sitter / shell dependency edges).
 */
const cache = new Map<string, { ts: number }>()

/** 60s TTL — repeated identical bash asks skip ctx.ask within the window. */
export const PERM_CACHE_TTL_MS = 60_000

export function permissionCacheKey(shell: string, patterns: Iterable<string>): string {
  return `${shell}:${[...patterns].sort().join("|")}`
}

/** Fast path: true when a successful ask for this key is still fresh. */
export function permissionCacheHit(key: string, now = Date.now()): boolean {
  const hit = cache.get(key)
  return !!hit && now - hit.ts < PERM_CACHE_TTL_MS
}

/** Record a successful ask (errors must not call this). */
export function permissionCacheSet(key: string, now = Date.now()): void {
  cache.set(key, { ts: now })
}

/** Clear when session/config permission rules change. */
export function invalidatePermissionCache(): void {
  cache.clear()
}
