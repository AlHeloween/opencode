/**
 * MD5-based Cache Chain Control
 *
 * Computes content-stable fingerprints for messages and requests.
 * Before sending to DeepSeek, compares prev vs next MD5 to detect
 * cache-breaking changes BEFORE they happen.
 *
 * Principle: if the fingerprint changed, DeepSeek's KV cache will miss.
 * Log every break with caller, position, and what changed.
 */

import { createHash } from "crypto"
import type { MessageV2 } from "./message-v2"
import { Database as BunDatabase } from "bun:sqlite"
import path from "path"
import { Path as GlobalPath } from "@opencode-ai/core/global"

// Separate SQLite DB for fingerprint persistence — avoids locking conflicts
// with the main drizzle DB and requires no migrations.
const FINGERPRINT_DB_PATH = path.join(GlobalPath.state, "cache_fingerprints.db")

// ── Types ──────────────────────────────────────────────────────────────────

export interface MessageFingerprint {
  messageId: string
  role: string
  md5: string
  partCount: number
  parts: Array<{ type: string; md5: string }>
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
  systemOnlyMd5: string
  /** Normalized tool schemas hash — order-invariant */
  toolsMd5: string
  /** Hash of sorted tool names only — detects pure reordering */
  toolsOrderHash: string
  /** Rough token estimate for tool schemas (chars/4) */
  toolsTokenEst: number
  /** Combined system + tools hash */
  prefixMd5: string
}

export interface RequestFingerprint {
  /** Hash of all system messages concatenated */
  systemMd5: string
  /** Ordered array of message fingerprints */
  messages: MessageFingerprint[]
  /** Full request hash (system + all messages) */
  fullMd5: string
  /** Token count estimate */
  estimatedTokens: number
  /** Prefix-level component hashes for cache-break diagnosis (set when toolSchemas provided) */
  prefix?: PrefixShape
}

export interface CacheAuditEntry {
  timestamp: number
  /** What triggered the request (agent name, "compaction", "chat") */
  caller: string
  /** Previous request fullMd5 (empty string if first request) */
  prevMd5: string
  /** Current request fullMd5 */
  nextMd5: string
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
    systemOnlyMd5: md5(systemOnly),
    toolsMd5: md5(toolsJSON),
    toolsOrderHash: md5(toolsOrderJSON),
    toolsTokenEst: Math.ceil(toolsJSON.length / 4),
    prefixMd5: md5(md5(systemOnly) + md5(toolsJSON)),
  }
}

// ── Hashing ────────────────────────────────────────────────────────────────

export function md5(content: string): string {
  return createHash("md5").update(content).digest("hex")
}

/** Stable string representation of a part, used for fingerprinting.
 *  Only includes content that affects the LLM token sequence. */
export function partFingerprint(part: MessageV2.Part): string {
  switch (part.type) {
    case "text":
      return `t:${part.id}:${md5(part.text.slice(0, 1024))}:${part.ignored ? 1 : 0}`
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
    md5: md5(partFingerprint(p)),
  }))

  const content = parts.map((p) => p.md5).join("|")
  const fingerprint = md5(`${msg.info.role}:${msg.info.id}:${content}`)

  return {
    messageId: msg.info.id,
    role: msg.info.role,
    md5: fingerprint,
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
  const systemMd5 = md5(systemContent)

  const msgFingerprints = messages.map((m) => messageFingerprint(m))

  const metaStr = [meta?.sessionId ?? "", meta?.modelId ?? "", meta?.providerId ?? ""].join(":")
  const fullContent = [metaStr, systemMd5, ...msgFingerprints.map((m) => m.md5)].join("|")
  const fullMd5 = md5(fullContent)

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
    systemMd5,
    messages: msgFingerprints,
    fullMd5,
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

function cacheStoreKey(sessionId: string, modelId: string): string {
  return `${sessionId}:${modelId}`
}

let _fpDb: BunDatabase | undefined
function fpDb(): BunDatabase {
  if (!_fpDb) {
    _fpDb = new BunDatabase(FINGERPRINT_DB_PATH, { create: true })
    _fpDb.run("PRAGMA journal_mode = WAL")
    _fpDb.run(
      "CREATE TABLE IF NOT EXISTS fingerprints (session_id TEXT NOT NULL, model_id TEXT NOT NULL, system_md5 TEXT NOT NULL, full_md5 TEXT NOT NULL, data TEXT NOT NULL, time_updated INTEGER NOT NULL, PRIMARY KEY (session_id, model_id))",
    )
  }
  return _fpDb
}

export function storePrevFingerprint(
  sessionId: string,
  modelId: string,
  fp: RequestFingerprint,
): void {
  const key = cacheStoreKey(sessionId, modelId)
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
        "INSERT OR REPLACE INTO fingerprints (session_id, model_id, system_md5, full_md5, data, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(sessionId, modelId, fp.systemMd5, fp.fullMd5, data, now)
  } catch {
    // Non-critical: in-memory cache still works for the current turn
  }
}

export function getPrevFingerprint(
  sessionId: string,
  modelId: string,
): RequestFingerprint | null {
  const key = cacheStoreKey(sessionId, modelId)
  const cached = prevRequestCache.get(key)
  if (cached) return cached

  // Memory miss — try the separate SQLite DB
  try {
    const row = fpDb()
      .query("SELECT data FROM fingerprints WHERE session_id = ? AND model_id = ?")
      .get(sessionId, modelId) as { data: string } | undefined
    if (row) {
      const fp = JSON.parse(row.data) as RequestFingerprint
      prevRequestCache.set(key, fp)
      if (prevRequestCache.size > MAX_FINGERPRINTS) {
        const first = prevRequestCache.keys().next().value
        if (first !== undefined) prevRequestCache.delete(first)
      }
      return fp
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
    prevMd5: prev?.fullMd5 ?? "",
    nextMd5: next.fullMd5,
    cacheStable: prev ? prev.fullMd5 === next.fullMd5 : false,
    divergenceIndex: -1,
    prevAtDivergence: "",
    nextAtDivergence: "",
    changeDescription: "none",
    estimatedHitRatio: 0,
  }

  // First request: no baseline
  if (!prev) {
    entry.changeDescription = "first request - no cache baseline"
      entry.estimatedHitRatio = 0
      entry.cacheStable = false
      return entry
  }

  // Component-level cache break diagnosis (when PrefixShape data is available).
  // Reports which component changed: system, tools-content, or tools-order.
  // Falls through to message-level scan when prefix data is unavailable
  // or when all prefix components are stable.
  if (prev.prefix && next.prefix) {
    if (prev.prefix.systemOnlyMd5 !== next.prefix.systemOnlyMd5) {
      entry.divergenceIndex = -1
      entry.prevAtDivergence = prev.prefix.systemOnlyMd5.slice(0, 8)
      entry.nextAtDivergence = next.prefix.systemOnlyMd5.slice(0, 8)
      entry.changeDescription = `system prompt changed (non-tool): ${prev.prefix.systemOnlyMd5.slice(0, 8)} → ${next.prefix.systemOnlyMd5.slice(0, 8)}`
      entry.cacheStable = false
      entry.estimatedHitRatio = 0
      return entry
    }
    if (prev.prefix.toolsMd5 !== next.prefix.toolsMd5) {
      entry.divergenceIndex = -1
      entry.prevAtDivergence = prev.prefix.toolsMd5.slice(0, 8)
      entry.nextAtDivergence = next.prefix.toolsMd5.slice(0, 8)
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
  if (prev.systemMd5 !== next.systemMd5) {
    entry.divergenceIndex = -1 // system level
    entry.prevAtDivergence = prev.systemMd5
    entry.nextAtDivergence = next.systemMd5
    entry.changeDescription = `system prompt changed (md5: ${prev.systemMd5.slice(0, 8)} → ${next.systemMd5.slice(0, 8)})`
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
    if (prevMsg.md5 === nextMsg.md5) {
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
      if (prevPart && nextPart && prevPart.md5 !== nextPart.md5) {
        entry.changeDescription = `part ${j} modified in message ${i} (${prevMsg.role}): ${prevPart.type} content changed`
        divergenceFound = true
        break
      }
    }

    if (divergenceFound) {
      entry.divergenceIndex = i
      entry.prevAtDivergence = `${prevMsg.role}:${prevMsg.messageId.slice(0, 12)} md5=${prevMsg.md5.slice(0, 8)}`
      entry.nextAtDivergence = `${nextMsg.role}:${nextMsg.messageId.slice(0, 12)} md5=${nextMsg.md5.slice(0, 8)}`
      break
    }
  }

  // Estimate hit ratio: fraction of messages that are identical
  const totalMsgs = Math.max(prev.messages.length, next.messages.length)
  const commonMsgs = (() => {
    let count = 0
    for (let i = 0; i < Math.min(prev.messages.length, next.messages.length); i++) {
      if (prev.messages[i].md5 === next.messages[i].md5) count++
    }
    return count
  })()
  entry.estimatedHitRatio = totalMsgs > 0 ? commonMsgs / totalMsgs : 0

  return entry
}

// ── Formatting (for logs) ──────────────────────────────────────────────────

export function formatAuditEntry(entry: CacheAuditEntry): string {
  if (entry.cacheStable) {
    return `[cache:stable] caller=${entry.caller} md5=${entry.nextMd5.slice(0, 12)} tokens=${entry.estimatedHitRatio > 0 ? (entry.estimatedHitRatio * 100).toFixed(0) + "%" : "N/A"}`
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
  console.log(`  msg1: ${fp1.md5.slice(0, 12)} (${fp1.partCount} parts)`)
  const fp1b = messageFingerprint(msg1)
  console.log(`  msg1 again: ${fp1b.md5.slice(0, 12)} (stable=${fp1.md5 === fp1b.md5})`)

  // Test 2: Request fingerprint
  console.log("\n── Test 2: Request fingerprint ──")
  const req1 = requestFingerprint(["You are helpful"], [msg1, msg2, msg3])
  console.log(`  request: ${req1.fullMd5.slice(0, 12)} (${req1.messages.length} msgs, ~${req1.estimatedTokens} tokens)`)

  // Test 3: Cache audit — identical
  console.log("\n── Test 3: Cache audit (identical) ──")
  const req2 = requestFingerprint(["You are helpful"], [msg1, msg2, msg3])
  const audit1 = auditCache(req1, req2, "chat")
  console.log(`  ${formatAuditEntry(audit1)}`)

  // Test 4: Cache audit — message modified
  console.log("\n── Test 4: Cache audit (message modified) ──")
  const msg1b = mockMsg("m1", "user", [
    mockTextPart("p1", "Write a DIFFERENT function"),
  ])
  const req3 = requestFingerprint(["You are helpful"], [msg1b, msg2, msg3])
  const audit2 = auditCache(req2, req3, "chat")
  console.log(`  ${formatAuditEntry(audit2)}`)

  // Test 5: Cache audit — new message appended
  console.log("\n── Test 5: Cache audit (new message) ──")
  const msg4 = mockMsg("m4", "user", [
    mockTextPart("p4", "One more thing"),
  ])
  const req4 = requestFingerprint(["You are helpful"], [msg1, msg2, msg3, msg4])
  const audit3 = auditCache(req2, req4, "chat")
  console.log(`  ${formatAuditEntry(audit3)}`)

  // Test 6: Cache audit — system prompt changed
  console.log("\n── Test 6: Cache audit (system changed) ──")
  const req5 = requestFingerprint(["You are a DIFFERENT assistant"], [msg1, msg2, msg3])
  const audit4 = auditCache(req2, req5, "chat")
  console.log(`  ${formatAuditEntry(audit4)}`)

  // Test 7: Tool schema normalization — order invariance
  console.log("\n── Test 7: Tool schema normalization ──")
  const toolsA: ToolSchema[] = [
    { name: "read", description: "Read a file", parameters: '{"type":"object","properties":{"path":{"type":"string"}}}' },
    { name: "write", description: "Write a file", parameters: '{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}}}' },
  ]
  const toolsB: ToolSchema[] = [
    { name: "write", description: "Write a file", parameters: '{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}}}' },
    { name: "read", description: "Read a file", parameters: '{"type":"object","properties":{"path":{"type":"string"}}}' },
  ]
  const normalized = normalizeToolSchemas(toolsB)
  console.log(`  normalized order: ${normalized.map((t) => t.name).join(", ")} (expected: read, write)`)

  // Test 8: PrefixShape — identical tools in different order → same hash
  console.log("\n── Test 8: PrefixShape order invariance ──")
  const reqA = requestFingerprint(["You are helpful"], [msg1], undefined, toolsA)
  const reqB = requestFingerprint(["You are helpful"], [msg1], undefined, toolsB)
  console.log(`  toolsMd5 match: ${reqA.prefix?.toolsMd5 === reqB.prefix?.toolsMd5} (expected: true)`)
  console.log(`  toolsOrderHash match: ${reqA.prefix?.toolsOrderHash === reqB.prefix?.toolsOrderHash} (expected: true)`)
  console.log(`  prefixMd5 match: ${reqA.prefix?.prefixMd5 === reqB.prefix?.prefixMd5} (expected: true)`)

  // Test 9: Component blame — tool content change
  console.log("\n── Test 9: Component blame (tool content change) ──")
  const toolsC: ToolSchema[] = [{ name: "z", description: "last", parameters: "{}" }]
  const toolsD: ToolSchema[] = [{ name: "z", description: "last", parameters: '{"extra":true}' }]
  const reqC = requestFingerprint(["Sys"], [msg1], undefined, toolsC)
  const reqD = requestFingerprint(["Sys"], [msg1], undefined, toolsD)
  const auditCD = auditCache(reqC, reqD, "test")
  console.log(`  blame: ${auditCD.changeDescription}`)

  // Test 10: Component blame — system changed, tools same
  console.log("\n── Test 10: Component blame (system changed, tools same) ──")
  const reqE = requestFingerprint(["System A"], [msg1], undefined, toolsA)
  const reqF = requestFingerprint(["System B"], [msg1], undefined, toolsA)
  const auditEF = auditCache(reqE, reqF, "test")
  console.log(`  blame: ${auditEF.changeDescription}`)

  // Test 11: Legacy — no toolSchemas provided (backward compat)
  console.log("\n── Test 11: Backward compat (no toolSchemas) ──")
  const reqNoTools = requestFingerprint(["You are helpful"], [msg1, msg2])
  console.log(`  prefix: ${reqNoTools.prefix ? "present" : "undefined"} (expected: undefined)`)
  console.log(`  systemMd5: ${reqNoTools.systemMd5.slice(0, 12)}`)
  console.log(`  fullMd5: ${reqNoTools.fullMd5.slice(0, 12)}`)

  console.log("\n[DONE] Cache control self-test complete.")
}

/** Extract ToolSchema[] from an AI SDK tool record.
  * Converts { name: Tool } → [{ name, description, parameters: JSON }] */
export function toolSchemasFromRecord(tools: Record<string, any>): ToolSchema[] {
  return Object.entries(tools).map(([name, t]) => ({
    name,
    description: typeof t?.description === "string" ? t.description : "",
    parameters: JSON.stringify(t?.parameters ?? {}),
  }))
}

export * as CacheControl from "./cache-control"
