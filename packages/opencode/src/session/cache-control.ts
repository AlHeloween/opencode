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

// ── Types ──────────────────────────────────────────────────────────────────

export interface MessageFingerprint {
  messageId: string
  role: string
  md5: string
  partCount: number
  parts: Array<{ type: string; md5: string }>
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

  return {
    systemMd5,
    messages: msgFingerprints,
    fullMd5,
    estimatedTokens,
  }
}

/** Per-session + model request fingerprint storage for cache chain tracking. */
const prevRequestCache = new Map<string, RequestFingerprint>()

function cacheStoreKey(sessionId: string, modelId: string): string {
  return `${sessionId}:${modelId}`
}

export function storePrevFingerprint(
  sessionId: string,
  modelId: string,
  fp: RequestFingerprint,
): void {
  prevRequestCache.set(cacheStoreKey(sessionId, modelId), fp)
}

export function getPrevFingerprint(
  sessionId: string,
  modelId: string,
): RequestFingerprint | null {
  return prevRequestCache.get(cacheStoreKey(sessionId, modelId)) ?? null
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
    return entry
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

  console.log("\n[DONE] Cache control self-test complete.")
}

export * as CacheControl from "./cache-control"
