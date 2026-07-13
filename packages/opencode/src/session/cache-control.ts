/**
 * XXH3-based Cache Chain Control
 *
 * Computes content-stable fingerprints for messages and requests.
 * Before sending to DeepSeek, compares prev vs next XXH3 to detect
 * cache-breaking changes BEFORE they happen.
 *
 * Principle: if the fingerprint changed, DeepSeek's KV cache will miss.
 * Log every break with caller, position, and what changed.
 *
 * XXH3 is used instead of MD5 for ~5x faster hashing with equivalent
 * collision resistance for natural-language fingerprinting.
 */

import xxhashWasm from "xxhash-wasm"
import type { MessageV2 } from "./message-v2"
import { Database as BunDatabase } from "bun:sqlite"
import path from "path"
import { Path as GlobalPath } from "@opencode-ai/core/global"

// Separate SQLite DB for fingerprint persistence — avoids locking conflicts
// with the main drizzle DB and requires no migrations.
const FINGERPRINT_DB_PATH = path.join(GlobalPath.state, "cache_fingerprints.db")

// ── XXH3 Initialization ────────────────────────────────────────────────────

let _h64: ((input: string) => string) | undefined
const init = xxhashWasm().then(({ h64ToString }) => { _h64 = h64ToString })

/** XXH3-64 hash as hex string. Sync after WASM init (resolves during first
 *  microtask after module load — guaranteed before any request handler runs). */
export function xxh3(content: string): string {
  if (!_h64) throw new Error("XXH3 not initialized (module init race)")
  return _h64(content)
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface MessageFingerprint {
  messageId: string
  role: string
  hash: string
  partCount: number
  parts: Array<{ type: string; hash: string }>
}

/** Lightweight tool schema shape for cache fingerprinting.
  * Only fields that affect the provider-side token sequence. */
export interface ToolSchema {
  name: string
  description: string
  parameters: string  // JSON-serialized schema (or raw string for hashing)
}

/** Prefix-level component hashes for cache-break diagnosis.
  * Captured alongside the existing message-level fingerprints. */
export interface PrefixShape {
  /** System prompt without tool schemas (tools stripped or passed separately) */
  systemOnlyHash: string
  /** Normalized tool schemas hash — order-invariant */
  toolsHash: string
  /** Hash of sorted tool names only — detects pure reordering */
  toolsOrderHash: string
  /** Rough token estimate for tool schemas (chars/4) */
  toolsTokenEst: number
  /** Combined system + tools hash */
  prefixHash: string
}

export interface RequestFingerprint {
  /** Hash of all system messages concatenated */
  systemHash: string
  /** Ordered array of message fingerprints */
  messages: MessageFingerprint[]
  /** Full request hash (system + all messages) */
  fullHash: string
  /** Token count estimate */
  estimatedTokens: number
  /** Prefix-level component hashes for cache-break diagnosis (set when toolSchemas provided) */
  prefix?: PrefixShape
}

export interface CacheAuditEntry {
  timestamp: number
  /** What triggered the request (agent name, "compaction", "chat") */
  caller: string
  /** Previous request fullHash (empty string if first request) */
  prevHash: string
  /** Current request fullHash */
  nextHash: string
  /** Did the cache chain survive? */
  cacheStable: boolean
  /** If broken: index of first diverging message */
  divergenceIndex: number
  /** If broken: what was in the previous message at the divergence point */
  prevAtDivergence: string
  /** If broken: what is in the current message at the divergence point */
  nextAtDivergence: string
  /** If broken: human-readable description of the change */
  changeDescription: string
  /** Estimated cache hit ratio if sent */
  estimatedHitRatio: number
}

// ── Tool Schema Normalization ──────────────────────────────────────────────

/** Sort tool schemas by name → description → parameter length.
  * Makes the tools hash order-invariant: identical tools in different order
  * produce the same hash, preventing unnecessary KV cache breaks. */
export function normalizeToolSchemas(schemas: ToolSchema[]): ToolSchema[] {
  const sorted = [...schemas]
  sorted.sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1
    if (a.description !== b.description) return a.description < b.description ? -1 : 1
    return a.parameters.length - b.parameters.length
  })
  return sorted
}

/** Compute a PrefixShape from system prompt array and tool schemas.
  * systemWithoutTools: system[] lines with tool-related sections stripped
  *   (callers pass the system array BEFORE tool injection, or strip tools).
  * toolSchemas: raw tool schema array (will be normalized internally). */
export function computePrefixShape(
  systemWithoutTools: string[],
  toolSchemas: ToolSchema[],
): PrefixShape {
  const normalized = normalizeToolSchemas(toolSchemas)
  const systemOnly = systemWithoutTools.join("\n")

  const toolsJSON = JSON.stringify(normalized.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  })))

  const toolsOrderJSON = JSON.stringify(normalized.map((t) => t.name))

  return {
    systemOnlyHash: xxh3(systemOnly),
    toolsHash: xxh3(toolsJSON),
    toolsOrderHash: xxh3(toolsOrderJSON),
    toolsTokenEst: Math.ceil(toolsJSON.length / 4),
    prefixHash: xxh3(xxh3(systemOnly) + xxh3(toolsJSON)),
  }
}

// ── Hashing ────────────────────────────────────────────────────────────────

/** Convert tool record map to ToolSchema array for fingerprinting. */
export function toolSchemasFromRecord(tools: Record<string, any>): ToolSchema[] {
  return Object.entries(tools).map(([name, t]) => ({
    name,
    description: typeof t?.description === "string" ? t.description : "",
    parameters: JSON.stringify(t?.parameters ?? {}),
  }))
}

/** Stable string representation of a part, used for fingerprinting.
 *  Only includes content that affects the LLM token sequence. */
export function partFingerprint(part: MessageV2.Part): string {
  switch (part.type) {
    case "text":
      return `t:${part.id}:${xxh3(part.text.slice(0, 1024))}:${part.ignored ? 1 : 0}`
    case "tool": {
      const p = part as any
      const outputLen = typeof p.state?.output === "string" ? p.state.output.length : 0
      const compacted = p.state?.time?.compacted ?? 0
      return `tl:${p.id}:${p.state?.status ?? "?"}:${outputLen}:${compacted}`
    }
    case "file":
      return `f:${part.id}:${part.mime}:${part.filename ?? ""}:${part.url.length}`
    case "reasoning":
      return `r:${part.id}:${part.text.length}`
    case "compaction":
      return `c:${part.id}`
    case "subtask":
      return `s:${part.id}`
    case "step-start":
      return "ss"
    default:
      return `${(part as any).type}:${(part as any).id ?? "?"}`
  }
}

// ── Message Fingerprint ────────────────────────────────────────────────────

export function messageFingerprint(msg: MessageV2.WithParts): MessageFingerprint {
  const parts = msg.parts.map((p) => ({
    type: p.type,
    hash: xxh3(partFingerprint(p)),
  }))

  const content = parts.map((p) => p.hash).join("|")
  const hash = xxh3(`${msg.info.role}:${msg.info.id}:${content}`)

  return {
    messageId: msg.info.id,
    role: msg.info.role,
    hash,
    partCount: parts.length,
    parts,
  }
}

// ── Request Fingerprint ────────────────────────────────────────────────────

export function requestFingerprint(
  system: string[],
  messages: MessageV2.WithParts[],
  meta?: { sessionId?: string; modelId?: string; providerId?: string },
  toolSchemas?: ToolSchema[],
): RequestFingerprint {
  const systemContent = system.join("\n")
  const systemHash = xxh3(systemContent)

  const msgFingerprints = messages.map((m) => messageFingerprint(m))

  const metaStr = [meta?.sessionId ?? "", meta?.modelId ?? "", meta?.providerId ?? ""].join(":")
  const fullContent = [metaStr, systemHash, ...msgFingerprints.map((m) => m.hash)].join("|")
  const fullHash = xxh3(fullContent)

  // Rough token estimate: ~4 chars per token
  const totalChars = systemContent.length + messages.reduce(
    (sum, m) => sum + m.parts.reduce((s, p) => {
      if (p.type === "text") return s + p.text.length
      if (p.type === "tool") return s + String((p as any).state?.output ?? "").length
      return s
    }, 0), 0,
  )
  const estimatedTokens = Math.ceil(totalChars / 4)

  // Compute prefix-level component hashes when tool schemas are provided
  const prefix = toolSchemas ? computePrefixShape(system, toolSchemas) : undefined

  return {
    systemHash,
    messages: msgFingerprints,
    fullHash,
    estimatedTokens,
    prefix,
  }
}

/** Per-session + model request fingerprint storage for cache chain tracking.
  * Dual-layer: in-memory Map (fast path) + separate SQLite DB (survives restarts).
  * Without SQLite, fingerprints are lost on process restart or session reopen,
  * causing full KV cache misses → model amnesia → 32k+ tokens wasted.
  * Uses a standalone .db file to avoid locking conflicts with the main drizzle DB. */
/** LRU-evicted at 500 entries to prevent unbounded growth over long sessions. */
const prevRequestCache = new Map<string, RequestFingerprint>()
const MAX_FINGERPRINTS = 500

function cacheStoreKey(sessionId: string, modelId: string, agentName?: string): string {
  return agentName ? `${sessionId}:${agentName}:${modelId}` : `${sessionId}:${modelId}`
}

let _fpDb: BunDatabase | undefined
function fpDb(): BunDatabase {
  if (!_fpDb) {
    _fpDb = new BunDatabase(FINGERPRINT_DB_PATH, { create: true })
    _fpDb.run("PRAGMA journal_mode = WAL")
    _fpDb.run(
      "CREATE TABLE IF NOT EXISTS fingerprints (session_id TEXT NOT NULL, agent_name TEXT NOT NULL DEFAULT '', model_id TEXT NOT NULL, system_md5 TEXT NOT NULL, full_md5 TEXT NOT NULL, data TEXT NOT NULL, time_updated INTEGER NOT NULL, PRIMARY KEY (session_id, agent_name, model_id))",
    )
  }
  return _fpDb
}

export function storePrevFingerprint(
  sessionId: string,
  modelId: string,
  fp: RequestFingerprint,
  agentName?: string,
): void {
  const key = cacheStoreKey(sessionId, modelId, agentName)
  prevRequestCache.set(key, fp)
  if (prevRequestCache.size > MAX_FINGERPRINTS) {
    const first = prevRequestCache.keys().next().value
    if (first !== undefined) prevRequestCache.delete(first)
  }

  // Persist to separate SQLite DB so the fingerprint survives restarts
  try {
    const now = Date.now()
    const data = JSON.stringify(fp)
    fpDb()
      .query(
        "INSERT OR REPLACE INTO fingerprints (session_id, agent_name, model_id, system_md5, full_md5, data, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(sessionId, agentName ?? "", modelId, fp.systemHash, fp.fullHash, data, now)
  } catch {
    // Non-critical: in-memory cache still works for the current turn
  }
}

export function getPrevFingerprint(
  sessionId: string,
  modelId: string,
  agentName?: string,
): RequestFingerprint | null {
  const key = cacheStoreKey(sessionId, modelId, agentName)
  const cached = prevRequestCache.get(key)
  if (cached) return cached

  // Memory miss — try the separate SQLite DB
  try {
    const row = fpDb()
      .query("SELECT data FROM fingerprints WHERE session_id = ? AND agent_name = ? AND model_id = ?")
      .get(sessionId, agentName ?? "", modelId) as { data: string } | undefined
    if (row) {
      const raw = JSON.parse(row.data) as any
      // Detect old MD5-era fingerprints (field name systemMd5, hash 32 hex chars).
      // MD5 and XXH3 produce different-length hashes (32 vs 16 hex chars), so
      // comparison would always fail and report a false cache break.
      // Instead, silently discard and let the next request create a fresh XXH3
      // baseline. This causes zero invalidation — just a clean slate.
      if (raw.systemMd5 && !raw.systemHash) {
        return null
      }
      prevRequestCache.set(key, raw as RequestFingerprint)
      if (prevRequestCache.size > MAX_FINGERPRINTS) {
        const first = prevRequestCache.keys().next().value
        if (first !== undefined) prevRequestCache.delete(first)
      }
      return raw as RequestFingerprint
    }
  } catch {
    // DB miss or parse error — return null
  }
  return null
}

// ── Cache Audit ────────────────────────────────────────────────────────────

export function auditCache(
  prev: RequestFingerprint | null,
  next: RequestFingerprint,
  caller: string,
): CacheAuditEntry {
  const entry: CacheAuditEntry = {
    timestamp: Date.now(),
    caller,
    prevHash: prev?.fullHash ?? "",
    nextHash: next.fullHash,
    cacheStable: prev ? prev.fullHash === next.fullHash : false,
    divergenceIndex: -1,
    prevAtDivergence: "",
    nextAtDivergence: "",
    changeDescription: "none",
    estimatedHitRatio: 0,
  }

  // First request: no baseline — no cache to invalidate
  if (!prev) {
    return entry
  }

  // Component-level cache break diagnosis (when PrefixShape data is available).
  // Reports which component changed: system, tools-content, or tools-order.
  // Falls through to message-level scan when prefix data is unavailable
  // or when all prefix components are stable.
  if (prev.prefix && next.prefix) {
    if (prev.prefix.systemOnlyHash !== next.prefix.systemOnlyHash) {
      entry.divergenceIndex = -1
      entry.prevAtDivergence = prev.prefix.systemOnlyHash.slice(0, 8)
      entry.nextAtDivergence = next.prefix.systemOnlyHash.slice(0, 8)
      entry.changeDescription = `system prompt changed (non-tool): ${prev.prefix.systemOnlyHash.slice(0, 8)} → ${next.prefix.systemOnlyHash.slice(0, 8)}`
      entry.cacheStable = false
      entry.estimatedHitRatio = 0
      return entry
    }
    if (prev.prefix.toolsHash !== next.prefix.toolsHash) {
      entry.divergenceIndex = -1
      entry.prevAtDivergence = prev.prefix.toolsHash.slice(0, 8)
      entry.nextAtDivergence = next.prefix.toolsHash.slice(0, 8)
      if (prev.prefix.toolsOrderHash === next.prefix.toolsOrderHash) {
        entry.changeDescription = "tool schemas changed (content or count)"
      } else {
        entry.changeDescription = "tool schemas changed (order + possibly content)"
      }
      entry.estimatedHitRatio = 0
      entry.cacheStable = false
      return entry
    }
    if (prev.prefix.toolsOrderHash !== next.prefix.toolsOrderHash) {
      entry.divergenceIndex = -1
      entry.prevAtDivergence = prev.prefix.toolsOrderHash.slice(0, 8)
      entry.nextAtDivergence = next.prefix.toolsOrderHash.slice(0, 8)
      entry.changeDescription = "tool order changed only (content identical)"
      entry.cacheStable = false
      entry.estimatedHitRatio = 0
      return entry
    }
    // Prefix components are stable — fall through to message-level scan
  }

  // System prompt changed?
  if (prev.systemHash !== next.systemHash) {
    entry.divergenceIndex = -1 // system level
    entry.prevAtDivergence = prev.systemHash
    entry.nextAtDivergence = next.systemHash
    entry.changeDescription = `system prompt changed (hash: ${prev.systemHash.slice(0, 8)} → ${next.systemHash.slice(0, 8)})`
    entry.estimatedHitRatio = 0 // System change = full cache invalidation
    return entry
  }

  // Message-by-message comparison
  const maxLen = Math.max(prev.messages.length, next.messages.length)
  let commonTokens = 0
  let divergenceFound = false

  for (let i = 0; i < maxLen; i++) {
    const prevMsg = prev.messages[i]
    const nextMsg = next.messages[i]

    // Previous exhausted, next has more → new messages appended
    if (!prevMsg && nextMsg) {
      entry.divergenceIndex = i
      entry.prevAtDivergence = "(end of previous request)"
      entry.nextAtDivergence = `new ${nextMsg.role} message: ${nextMsg.messageId}`
      entry.changeDescription = `new message appended at position ${i} (${nextMsg.role})`
      break
    }

    // Next exhausted, previous had more → messages removed
    if (prevMsg && !nextMsg) {
      entry.divergenceIndex = i
      entry.prevAtDivergence = `${prevMsg.role} message: ${prevMsg.messageId}`
      entry.nextAtDivergence = "(message removed)"
      entry.changeDescription = `message removed at position ${i}`
      break
    }

    if (!prevMsg || !nextMsg) continue

    // Message identical
    if (prevMsg.hash === nextMsg.hash) {
      commonTokens += prevMsg.partCount * 50 // rough token estimate per part
      continue
    }

    // Message diverged: find which part changed
    for (let j = 0; j < Math.max(prevMsg.parts.length, nextMsg.parts.length); j++) {
      const prevPart = prevMsg.parts[j]
      const nextPart = nextMsg.parts[j]

      if (!prevPart && nextPart) {
        entry.changeDescription = `new part added in message ${i} (${prevMsg.role}), part ${j} (${nextPart.type})`
        divergenceFound = true
        break
      }
      if (prevPart && !nextPart) {
        entry.changeDescription = `part removed from message ${i} (${prevMsg.role}), part ${j} (${prevPart.type})`
        divergenceFound = true
        break
      }
      if (prevPart && nextPart && prevPart.hash !== nextPart.hash) {
        entry.changeDescription = `part ${j} modified in message ${i} (${prevMsg.role}): ${prevPart.type} content changed`
        divergenceFound = true
        break
      }
    }

    if (divergenceFound) {
      entry.divergenceIndex = i
      entry.prevAtDivergence = `${prevMsg.role}:${prevMsg.messageId.slice(0, 12)} hash=${prevMsg.hash.slice(0, 8)}`
      entry.nextAtDivergence = `${nextMsg.role}:${nextMsg.messageId.slice(0, 12)} hash=${nextMsg.hash.slice(0, 8)}`
      break
    }
  }

  // Estimate hit ratio: fraction of messages that are identical
  const totalMsgs = Math.max(prev.messages.length, next.messages.length)
  const commonMsgs = (() => {
    let count = 0
    for (let i = 0; i < Math.min(prev.messages.length, next.messages.length); i++) {
      if (prev.messages[i].hash === next.messages[i].hash) count++
    }
    return count
  })()
  entry.estimatedHitRatio = totalMsgs > 0 ? commonMsgs / totalMsgs : 0

  return entry
}

// ── Formatting (for logs) ──────────────────────────────────────────────────

export function formatAuditEntry(entry: CacheAuditEntry): string {
  if (entry.cacheStable) {
    return `[cache:stable] caller=${entry.caller} hash=${entry.nextHash.slice(0, 12)} tokens=${entry.estimatedHitRatio > 0 ? (entry.estimatedHitRatio * 100).toFixed(0) + "%" : "N/A"}`
  }
  return [
    `[cache:broken]`,
    `caller=${entry.caller}`,
    `divergence@${entry.divergenceIndex}`,
    `prev=${entry.prevAtDivergence}`,
    `next=${entry.nextAtDivergence}`,
    `cause=${entry.changeDescription}`,
    `hit_ratio=${(entry.estimatedHitRatio * 100).toFixed(0)}%`,
  ].join(" ")
}

// ── Self-test ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  // Create mock messages for testing
  const mockTextPart = (id: string, text: string): any => ({
    type: "text", id, text, ignored: false,
  })

  const mockMsg = (id: string, role: string, parts: any[]): any => ({
    info: { id, role },
    parts,
  })

  const msg1 = mockMsg("m1", "user", [
    mockTextPart("p1", "Write a function"),
  ])

  const msg2 = mockMsg("m2", "assistant", [
    mockTextPart("p2", "Here is the function"),
  ])

  const msg3 = mockMsg("m3", "user", [
    mockTextPart("p3", "Fix the bug"),
  ])

  // Test 1: Fingerprint generation
  console.log("── Test 1: Message fingerprint ──")
  const fp1 = messageFingerprint(msg1)
  console.log(`  msg1: ${fp1.hash.slice(0, 12)} (${fp1.partCount} parts)`)
  const fp1b = messageFingerprint(msg1)
  console.log(`  msg1 again: ${fp1b.hash.slice(0, 12)} (stable=${fp1.hash === fp1b.hash})`)

  // Test 2: Request fingerprint
  console.log("\n── Test 2: Request fingerprint ──")
  const req1 = requestFingerprint(["You are helpful"], [msg1, msg2, msg3])
  console.log(`  request: ${req1.fullHash.slice(0, 12)} (${req1.messages.length} msgs, ~${req1.estimatedTokens} tokens)`)

  // Test 3: Cache audit — identical
  console.log("\n── Test 3: Cache audit (identical) ──")
  const req2 = requestFingerprint(["You are helpful"], [msg1, msg2, msg3])
  const audit1 = auditCache(req1, req2, "test")
  console.log(`  stable: ${audit1.cacheStable} (expected: true)`)

  // Test 4: Cache audit — system changed
  console.log("\n── Test 4: Cache audit (system changed) ──")
  const req3 = requestFingerprint(["You are evil"], [msg1, msg2, msg3])
  const audit2 = auditCache(req1, req3, "test")
  console.log(`  stable: ${audit2.cacheStable} (expected: false)`)
  console.log(`  cause: ${audit2.changeDescription}`)

  // Test 5: Cache audit — message added
  console.log("\n── Test 5: Cache audit (message added) ──")
  const req4 = requestFingerprint(["You are helpful"], [msg1, msg2, msg3, msg1])
  const audit3 = auditCache(req1, req4, "test")
  console.log(`  stable: ${audit3.cacheStable} (expected: false)`)
  console.log(`  cause: ${audit3.changeDescription}`)
}

export * as CacheControl from "./cache-control"
