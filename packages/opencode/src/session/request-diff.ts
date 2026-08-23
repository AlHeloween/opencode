/**
 * KV Cache Diff Logging.
 *
 * Formats LLM requests (system + model messages) as diffable text,
 * computes structural diffs between consecutive turns, and writes .diff
 * files under `{data}/log/` via logPath("diff", model, sessionID, "diff").
 *
 * Previous request text is kept in-process (and may be seeded from a
 * checkpoint) so diffs still appear after compact/rebuild when disk
 * checkpoint was removed.
 *
 * Diff strategy (section-aware like difftastic):
 *   META    → key-by-key comparison, show only changed fields
 *   SYSTEM  → line-level diff with 3-line context windows, collapses
 *             unchanged regions to a count line
 *   MESSAGES → prefer message id= keys; fall back to content hash
 *
 * [KV-CACHE SAFE] — pure read-side logging, zero impact on provider request bytes.
 */
import path from "path"
import { EOL } from "os"
import fs from "fs"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import type { ModelMessage } from "ai"
import { Global } from "@opencode-ai/core/global"
import { logPath } from "@opencode-ai/core/util/log"
import * as Log from "@opencode-ai/core/util/log"
import { errorMessage } from "@/util/error"
import { OUTPUT_TOKEN_MAX } from "@/provider/transform"

const log = Log.create({ service: "request-diff" })

const MAX_DIFFS_PER_SESSION = 200
const KEY_DERIVATION_SALT = ":opencode-diff-baseline-v1"
const MAX_FORMATTED_REQUEST_CHARS = 256 * 1024
const MAX_FORMATTED_SYSTEM_CHARS = 64 * 1024
const MAX_FORMATTED_MESSAGE_CHARS = OUTPUT_TOKEN_MAX * 4

/** Metadata attached to each diff entry. */
export interface DiffMeta {
  sessionID: string
  modelID: string
  providerID: string
  turn: number
  agent: string
  timestamp: number
}

/** Per-session diff counter for FIFO rotation of .diff files. */
const countMap = new Map<string, number>()

/** Last formatted request per session+model+agent (for post-compact diffs). */
const previousFormatted = new Map<string, { text: string; meta: DiffMeta }>()

function prevKey(meta: Pick<DiffMeta, "sessionID" | "providerID" | "modelID" | "agent">): string {
  return `${meta.sessionID}\0${meta.providerID}\0${meta.modelID}\0${meta.agent}`
}

/** Remember formatted request for the next turn's diff (in-process only). */
export function rememberFormatted(text: string, meta: DiffMeta): void {
  previousFormatted.set(prevKey(meta), { text, meta })
}

/** Load previous formatted request if any (does not clear). */
export function getPreviousFormatted(
  meta: Pick<DiffMeta, "sessionID" | "providerID" | "modelID" | "agent">,
): { text: string; meta: DiffMeta } | undefined {
  return previousFormatted.get(prevKey(meta))
}

/** Drop remembered formatted requests for a session (optional; compact keeps them for one transition). */
export function clearPreviousFormatted(sessionID: string): void {
  const prefix = `${sessionID}\0`
  for (const key of previousFormatted.keys()) {
    if (key.startsWith(prefix)) previousFormatted.delete(key)
  }
}

export type FormatRequestOpts = {
  /**
   * Start index into modelMsgs/messageIDs (inclusive). Use checkpoint prefixLen
   * so only new/dirty suffix is formatted — O(new) not O(history).
   */
  fromIndex?: number
  /**
   * When the byte budget is exceeded, prefer newest messages (suffix-first).
   * Default true so huge sessions do not only capture ancient prefix.
   */
  preferNewest?: boolean
}

/**
 * Format the LLM request (system prompt + model messages) as
 * a deterministic, human-readable text blob for diffing.
 * Optional messageIDs (parallel to modelMsgs — MODEL-indexed, expanded via
 * Checkpoint.expandMessageIDs when tool-calls expand 1:N) enable id-stable
 * MESSAGES diffs. DB-indexed IDs misalign after the first expansion and make
 * headers flicker between requests → false remove+add diffs.
 *
 * Pass `fromIndex` (e.g. checkpoint reusable prefix length) to format only the
 * delta — the common case between consecutive turns.
 */
export function formatRequest(
  system: string[],
  modelMsgs: ModelMessage[],
  meta: DiffMeta,
  messageIDs?: string[],
  opts?: FormatRequestOpts,
): string {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0
  const from = Math.max(0, Math.min(opts?.fromIndex ?? 0, modelMsgs.length))
  const preferNewest = opts?.preferNewest !== false
  const slice = modelMsgs.slice(from)
  const idSlice = messageIDs?.slice(from)

  const lines: string[] = []
  let chars = 0
  const pushLine = (line: string): boolean => {
    if (chars >= MAX_FORMATTED_REQUEST_CHARS) return false
    const next = chars + line.length + 1
    if (next <= MAX_FORMATTED_REQUEST_CHARS) {
      lines.push(line)
      chars = next
      return true
    }

    const suffix = `... (request diff baseline truncated at ${MAX_FORMATTED_REQUEST_CHARS} chars)`
    const remaining = MAX_FORMATTED_REQUEST_CHARS - chars
    lines.push(
      remaining > suffix.length + 1
        ? `${line.slice(0, remaining - suffix.length - 1)}\n${suffix}`
        : suffix,
    )
    chars = MAX_FORMATTED_REQUEST_CHARS
    return false
  }

  pushLine("=== META ===")
  pushLine(`session: ${meta.sessionID}`)
  pushLine(`model: ${meta.providerID}/${meta.modelID}`)
  pushLine(`agent: ${meta.agent}`)
  pushLine(`turn: ${meta.turn}`)
  pushLine(`timestamp: ${new Date(meta.timestamp).toISOString()}`)
  if (from > 0) pushLine(`messages_from_index: ${from}`)

  pushLine("")
  pushLine("=== SYSTEM ===")
  for (const s of system) {
    if (!pushLine(truncateText(s, MAX_FORMATTED_SYSTEM_CHARS, "system entry"))) {
      log.debug("formatRequest", {
        from,
        modelMsgs: modelMsgs.length,
        formatted: 0,
        ms: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - t0),
        truncated: true,
      })
      return lines.join("\n")
    }
  }

  pushLine("")
  pushLine("=== MESSAGES ===")

  // Pre-format message blocks, then emit oldest→newest or drop oldest under budget.
  const blocks: string[] = []
  for (let i = 0; i < slice.length; i++) {
    blocks.push(formatModelMessage(slice[i], from + i, idSlice?.[i]))
  }

  if (preferNewest && blocks.length > 0) {
    // Greedy from the end: keep newest messages that fit remaining budget.
    const budget = MAX_FORMATTED_REQUEST_CHARS - chars
    let used = 0
    let start = blocks.length
    for (let i = blocks.length - 1; i >= 0; i--) {
      const need = blocks[i].length + 1
      if (used + need > budget && start < blocks.length) break
      if (used + need > budget) {
        // Single oversized newest block — still push via pushLine truncation.
        start = i
        break
      }
      used += need
      start = i
    }
    if (start > 0) {
      pushLine(`... (${start} older messages omitted; suffix-only)`)
    }
    for (let i = start; i < blocks.length; i++) {
      if (!pushLine(blocks[i])) break
    }
  } else {
    for (const block of blocks) {
      if (!pushLine(block)) break
    }
  }

  log.debug("formatRequest", {
    from,
    modelMsgs: modelMsgs.length,
    formatted: blocks.length,
    ms: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - t0),
    chars,
  })
  return lines.join("\n")
}

/** Format a single ModelMessage for display. */
function formatModelMessage(msg: ModelMessage, index: number, messageID?: string): string {
  const idPart = messageID ? ` id=${messageID}` : ""
  return `[${msg.role}] #${index + 1}${idPart}\n${truncateText(
    formatMessageContent(msg),
    MAX_FORMATTED_MESSAGE_CHARS,
    "message",
  )}`
}

// ── Shared encryption primitives (used by checkpoint.ts) ──────────────────────

/**
 * Derive an AES-128-GCM key from project+session identity.
 * Uses Node.js crypto (synchronous, no crypto.subtle). Key is 16 bytes.
 * Deterministic — same inputs always produce the same key.
 */
export function deriveKey(projectID: string, sessionID: string): Buffer {
  const material = `${projectID}:${sessionID}${KEY_DERIVATION_SALT}`
  return createHash("sha256").update(material).digest().subarray(0, 16)
}

/** Encrypt a string with AES-128-GCM. Returns IV (12 bytes) + ciphertext + authTag (16 bytes). */
export function encryptBaseline(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-128-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, encrypted, authTag])
}

/** Decrypt an AES-128-GCM ciphertext (IV + data + authTag format). */
export function decryptBaseline(encrypted: Buffer, key: Buffer): string {
  const iv = encrypted.subarray(0, 12)
  const authTag = encrypted.subarray(encrypted.length - 16)
  const ciphertext = encrypted.subarray(12, encrypted.length - 16)
  const decipher = createDecipheriv("aes-128-gcm", key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}

/**
 * Clean up in-memory diff state for a deleted session
 * (FIFO counter + remembered previous formatted request).
 */
export function deleteBaselines(sessionID: string): void {
  countMap.delete(sessionID)
  clearPreviousFormatted(sessionID)
}

/** Sanitize a string for use in filenames. */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "-")
}

/** Escape regex special characters. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isWordChar(ch: string): boolean {
  // Letter (any script), number, or underscore — these are continuations, not boundaries.
  return /[\p{L}\p{N}_]/u.test(ch)
}

function truncateText(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text
  // Find last non-word-character boundary before maxChars
  // to avoid splitting words or Unicode grapheme clusters mid-character.
  // Scans back up to 200 chars; falls back to hard cut if no boundary found.
  let cut = maxChars
  for (let i = maxChars - 1; i > maxChars - 200 && i > 0; i--) {
    if (!isWordChar(text[i])) {
      cut = i + 1 // include the boundary character
      break
    }
  }
  return `${text.slice(0, cut)}\n... (${text.length - cut} more chars truncated from ${label})`
}

function stringifyForDiff(value: unknown): string {
  const json = JSON.stringify(value)
  return json ?? String(value)
}

/** Convert message content to a string for diffing. */
function formatMessageContent(msg: ModelMessage): string {
  const content = msg.content

  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === "text") {
          return `[text] ${truncateText(part.text, MAX_FORMATTED_MESSAGE_CHARS, "text part")}`
        }
        if (part.type === "reasoning") {
          return `[reasoning] ${truncateText(part.text, MAX_FORMATTED_MESSAGE_CHARS, "reasoning part")}`
        }
        if (part.type === "tool-call") {
          return `[tool-call:${part.toolName}] id=${part.toolCallId} input=${truncateText(
            stringifyForDiff(part.input),
            MAX_FORMATTED_MESSAGE_CHARS,
            "tool input",
          )}`
        }
        if (part.type === "tool-result") {
          return `[tool-result:${part.toolName}] id=${part.toolCallId}\n${truncateText(
            typeof part.output === "string" ? part.output : stringifyForDiff(part.output),
            MAX_FORMATTED_MESSAGE_CHARS,
            "tool result",
          )}`
        }
        if (part.type === "image") return `[image] ${typeof part.image === "string" ? part.image : "<binary>"}`
        if (part.type === "file") {
          return `[file] ${
            part.filename ?? truncateText(stringifyForDiff(part.data), MAX_FORMATTED_MESSAGE_CHARS, "file data")
          }`
        }
        if (part.type === "tool-approval-request") return `[tool-approval-request] approvalId=${part.approvalId} toolCallId=${part.toolCallId}`
        if (part.type === "tool-approval-response") return `[tool-approval-response] approvalId=${part.approvalId} approved=${part.approved}`
        // Exhaustive: all known part types handled above
        const _exhaustive = part as never
        return `[${(_exhaustive as { type: string }).type}]`
      })
      .join("\n")
  }

  return stringifyForDiff(content)
}

// ── Section-aware structural diff ───────────────────────────────────────────

const CONTEXT_LINES = 3
const MAX_OUTPUT_LINES = 300

/**
 * Compute a structural diff between two formatted requests.
 * Parses into META / SYSTEM / MESSAGES sections and diffs each independently.
 * Returns empty string when `prev` is null (first turn of session).
 */
export function diffRequest(
  prev: string | undefined,
  curr: string,
  prevMeta: DiffMeta | undefined,
  currMeta: DiffMeta,
): string {
  if (!prev || !prevMeta) return ""

  const out: string[] = []

  // Header
  const prevTs = new Date(prevMeta.timestamp).toISOString()
  const currTs = new Date(currMeta.timestamp).toISOString()
  out.push(`--- turn-${prevMeta.turn}  ${prevTs}`)
  out.push(`+++ turn-${currMeta.turn}  ${currTs}`)

  // Parse into sections
  const prevSections = parseSections(prev)
  const currSections = parseSections(curr)

  // Diff META
  const metaDiff = diffMetaKeys(prevSections.meta, currSections.meta)
  if (metaDiff.length > 0) {
    out.push("", "@@ META @@")
    out.push(...metaDiff)
  }

  // Diff SYSTEM
  const sysDiff = diffLinesHunked(
    prevSections.system,
    currSections.system,
    "SYSTEM",
  )
  if (sysDiff.length > 0) {
    out.push("", ...sysDiff)
  }

  // Diff MESSAGES
  const msgDiff = diffMessages(prevSections.messages, currSections.messages)
  if (msgDiff.length > 0) {
    out.push("", ...msgDiff)
  }

  // If nothing changed at all
  if (out.length <= 2) {
    out.push("", "(no changes — identical request content)")
  }

  // Cap total output
  if (out.length > MAX_OUTPUT_LINES) {
    const trimmed = out.slice(0, MAX_OUTPUT_LINES)
    trimmed.push(`... (${out.length - MAX_OUTPUT_LINES} more lines omitted)`)
    return trimmed.join("\n")
  }

  return out.join("\n")
}

interface ParsedSections {
  meta: string[]
  system: string[]
  messages: string[]
}

/** Split a formatted request into META / SYSTEM / MESSAGES sections. */
function parseSections(text: string): ParsedSections {
  const lines = text.split("\n")
  const meta: string[] = []
  const system: string[] = []
  const messages: string[] = []

  let section: "meta" | "system" | "messages" | "done" = "meta"

  for (const line of lines) {
    if (line === "=== META ===") {
      continue
    }
    if (line === "=== SYSTEM ===") {
      section = "system"
      continue
    }
    if (line === "=== MESSAGES ===") {
      section = "messages"
      continue
    }
    if (section === "meta") meta.push(line)
    else if (section === "system") system.push(line)
    else if (section === "messages") messages.push(line)
  }

  return { meta, system, messages }
}

/** Diff META key:value lines — only show changed keys. */
function diffMetaKeys(prev: string[], curr: string[]): string[] {
  const out: string[] = []
  const prevMap = new Map<string, string>()
  const currMap = new Map<string, string>()

  for (const line of prev) {
    const sep = line.indexOf(":")
    if (sep >= 0) prevMap.set(line.slice(0, sep), line.slice(sep + 1).trim())
  }
  for (const line of curr) {
    const sep = line.indexOf(":")
    if (sep >= 0) currMap.set(line.slice(0, sep), line.slice(sep + 1).trim())
  }

  const allKeys = new Set([...prevMap.keys(), ...currMap.keys()])
  let changed = 0
  for (const key of allKeys) {
    const pv = prevMap.get(key)
    const cv = currMap.get(key)
    if (pv === undefined && cv !== undefined) {
      changed++
      out.push(`+ ${key}: ${cv}`)
    } else if (cv === undefined && pv !== undefined) {
      changed++
      out.push(`- ${key}: ${pv}`)
    } else if (pv !== cv) {
      changed++
      out.push(`- ${key}: ${pv}`)
      out.push(`+ ${key}: ${cv}`)
    }
  }

  if (changed === 0) return []
  return out
}

/**
 * Compact line-level diff with context windows.
 * Collapses runs of identical lines into a count note (like difftastic).
 */
function diffLinesHunked(
  prev: string[],
  curr: string[],
  sectionLabel: string,
): string[] {
  const ops = alignLines(prev, curr)

  // Count total stats
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.type === "+") added++
    if (op.type === "-") removed++
  }
  if (added === 0 && removed === 0) return []

  // Find change regions: runs of +/- ops (with context padding)
  const changeIndices: number[] = []
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== "==") changeIndices.push(i)
  }
  if (changeIndices.length === 0) return []

  // Build context windows around each change index
  const keep = new Set<number>()
  for (const ci of changeIndices) {
    for (let k = ci - CONTEXT_LINES; k <= ci + CONTEXT_LINES; k++) {
      if (k >= 0 && k < ops.length) keep.add(k)
    }
  }

  // Build output: emit ops, collapse skipped regions
  const out: string[] = []
  out.push(`@@ ${sectionLabel} @@ ${added} added, ${removed} removed`)

  let skipped = 0
  for (let i = 0; i < ops.length; i++) {
    if (keep.has(i)) {
      // Flush skipped count before this kept line
      if (skipped > 0) {
        out.push(`... (${skipped} identical lines)`)
        skipped = 0
      }
      const op = ops[i]
      if (op.type === "==") out.push(` ${op.line}`)
      else if (op.type === "-") out.push(`-${op.line}`)
      else out.push(`+${op.line}`)
    } else {
      skipped++
    }
  }
  if (skipped > 0) {
    out.push(`... (${skipped} identical lines)`)
  }

  return out
}

/** Simple line-by-line alignment using sync-point search. */
interface EditOp {
  type: "==" | "-" | "+"
  line: string
}

function alignLines(prev: string[], curr: string[]): EditOp[] {
  const ops: EditOp[] = []
  let i = 0
  let j = 0

  // Fast-path: skip common prefix. Most turns share an identical system
  // prompt (byte-identical thanks to checkpoint caching). Skipping the
  // prefix avoids O(window²) sync-point search for hundreds of identical
  // lines — saving ~180K comparisons per diff on a typical session.
  const minLen = Math.min(prev.length, curr.length)
  while (i < minLen && prev[i] === curr[j]) {
    ops.push({ type: "==", line: prev[i] })
    i++
    j++
  }

  while (i < prev.length || j < curr.length) {
    if (i < prev.length && j < curr.length && prev[i] === curr[j]) {
      ops.push({ type: "==", line: prev[i] })
      i++
      j++
      continue
    }

    // Find next sync point
    let syncP = -1
    let syncC = -1
    const window = 30
    for (let si = i; si < Math.min(i + window, prev.length) && syncP === -1; si++) {
      for (let sj = j; sj < Math.min(j + window, curr.length); sj++) {
        if (prev[si] === curr[sj]) {
          syncP = si
          syncC = sj
          break
        }
      }
    }

    if (syncP >= 0) {
      for (let k = i; k < syncP; k++) {
        ops.push({ type: "-", line: prev[k] })
      }
      for (let k = j; k < syncC; k++) {
        ops.push({ type: "+", line: curr[k] })
      }
      i = syncP
      j = syncC
    } else {
      for (let k = i; k < prev.length; k++) {
        ops.push({ type: "-", line: prev[k] })
      }
      for (let k = j; k < curr.length; k++) {
        ops.push({ type: "+", line: curr[k] })
      }
      break
    }
  }

  return ops
}

/** Diff messages by id= when present, else content hash. */
function diffMessages(prev: string[], curr: string[]): string[] {
  const out: string[] = []
  out.push("@@ MESSAGES @@")

  const prevMsgs = splitMessages(prev)
  const currMsgs = splitMessages(curr)

  const prevKeys = prevMsgs.map((m) => messageKey(m))
  const currKeys = currMsgs.map((m) => messageKey(m))
  const prevByKey = new Map(prevKeys.map((k, i) => [k, i]))
  const currByKey = new Map(currKeys.map((k, i) => [k, i]))

  const removedMsgs: number[] = []
  const addedMsgs: number[] = []
  const changedMsgs: { prev: number; curr: number }[] = []

  for (let i = 0; i < prevMsgs.length; i++) {
    const j = currByKey.get(prevKeys[i])
    if (j === undefined) {
      removedMsgs.push(i)
      continue
    }
    if (hashString(prevMsgs[i].join("\n")) !== hashString(currMsgs[j].join("\n"))) {
      changedMsgs.push({ prev: i, curr: j })
    }
  }
  for (let i = 0; i < currMsgs.length; i++) {
    if (!prevByKey.has(currKeys[i])) addedMsgs.push(i)
  }

  if (addedMsgs.length === 0 && removedMsgs.length === 0 && changedMsgs.length === 0) return []

  out.push(
    `${addedMsgs.length} added, ${removedMsgs.length} removed, ${changedMsgs.length} changed`,
  )

  const pushSnippet = (prefix: string, lines: string[]) => {
    out.push(`${prefix} ${lines[0]}`)
    for (let l = 1; l < Math.min(lines.length, 3); l++) {
      out.push(`${prefix}   ${lines[l]}`)
    }
  }

  for (const idx of removedMsgs) pushSnippet("-", prevMsgs[idx])
  for (const idx of addedMsgs) pushSnippet("+", currMsgs[idx])
  for (const { prev: pi, curr: ci } of changedMsgs) {
    pushSnippet("-", prevMsgs[pi])
    pushSnippet("+", currMsgs[ci])
  }

  return out
}

/** Stable key: prefer id= from header, else content hash. */
function messageKey(lines: string[]): string {
  const header = lines[0] ?? ""
  const idMatch = header.match(/\bid=([^\s]+)/)
  if (idMatch) return `id:${idMatch[1]}`
  return `h:${hashString(lines.join("\n"))}`
}

/** Split message lines into per-message groups based on `[role] #N` headers. */
function splitMessages(lines: string[]): string[][] {
  const groups: string[][] = []
  let current: string[] = []

  for (const line of lines) {
    if (/^\[(user|assistant|tool|system)\]\s+#\d+/.test(line)) {
      if (current.length > 0) groups.push(current)
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) groups.push(current)

  return groups
}

/** Fast non-cryptographic hash for content comparison. */
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return h
}

/**
 * Write a diff under `{data}/log/` via logPath("diff", …).
 * FIFO rotation per session when exceeding MAX_DIFFS_PER_SESSION.
 * Returns the absolute file path after the content is durable for the caller.
 */
export function writeDiff(diffContent: string, meta: DiffMeta): string {
  const count = (countMap.get(meta.sessionID) ?? 0) + 1
  countMap.set(meta.sessionID, count)

  if (count > MAX_DIFFS_PER_SESSION) {
    const logDir = Global.Path.log
    const pattern = /^\d{13}_diff_.+\.diff$/
    const safeSid = sanitize(meta.sessionID)
    try {
      const files = fs.readdirSync(logDir)
        .filter((f) => pattern.test(f) && f.includes(`_${safeSid}.diff`))
        .sort()
      if (files.length > 0) {
        fs.unlinkSync(path.join(logDir, files[0]))
      }
    } catch (e) {
      log.debug("diff FIFO rotation failed", { sessionID: meta.sessionID, error: errorMessage(e) })
    }
  }

  const filepath = logPath("diff", meta.modelID, meta.sessionID, "diff")
  try {
    fs.mkdirSync(path.dirname(filepath), { recursive: true })
    fs.writeFileSync(filepath, diffContent + EOL)
  } catch (e) {
    log.debug("diff write failed", { filepath, error: errorMessage(e) })
  }
  return filepath
}

export * as RequestDiff from "./request-diff"
