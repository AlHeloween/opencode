// OpenRouter response-caching opt-in headers.
//
// Verified against https://openrouter.ai/docs/guides/features/response-caching
// (fetched 2026-09-07): `X-OpenRouter-Cache: true` enables caching of IDENTICAL
// API responses; `X-OpenRouter-Cache-TTL` (1-86400 seconds, default 300) sets
// retention. This is response caching — NOT prompt caching (no such TTL exists
// for prompt caches; sticky routing there is 10 min / session_id based).
//
// Opt-in only: `provider.<id>.options.responseCache: true` and optional
// `responseCacheTtl: <seconds>`. Anything non-openrouter returns {}.

const OPENROUTER_CACHE_MAX_TTL = 86400

export function responseCacheHeaders(providerID: string, options: Record<string, any> | undefined): Record<string, string> {
  if (providerID !== "openrouter") return {}
  if (options?.["responseCache"] !== true) return {}
  const headers: Record<string, string> = { "X-OpenRouter-Cache": "true" }
  const ttl = Number(options?.["responseCacheTtl"])
  if (Number.isFinite(ttl)) {
    headers["X-OpenRouter-Cache-TTL"] = String(Math.min(Math.max(Math.trunc(ttl), 1), OPENROUTER_CACHE_MAX_TTL))
  }
  return headers
}
