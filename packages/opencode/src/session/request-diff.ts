/**
 * KV Cache Diff Logging.
 *
 * Formats LLM requests (system + model messages) as diffable text,
 * computes structural diffs between consecutive turns, and writes .diff
 * files to the flat `.opencode/data/log/` directory using the unified
 * naming convention: `{time_ms}_diff_{model}_{sessionID}.diff`.
 *
 * Diff strategy (section-aware like difftastic):
 *   META    → key-by-key comparison, show only changed fields
 *   SYSTEM  → line-level diff with 3-line context windows, collapses
 *             unchanged regions to a count line
 *   MESSAGES → message-by-message comparison via content hash;
 *             shows added/removed/changed messages with headers
 *
 * [KV-CACHE SAFE] — pure read-side logging, zero impact on provider request bytes.
 */
import path from "path"
import { EOL } from "os"
import fs from "fs"
import { createHash } from "node:crypto"
import type { ModelMessage } from "ai"
import { Global } from "@opencode-ai/core/global"
import { logPath } from "@opencode-ai/core/util/log"

const BASELINES_DIR = ".baselines"
const MAX_DIFFS_PER_SESSION = 200
const BASELINE_VERSION = 1
const KEY_DERIVATION_SALT = ":opencode-diff-baseline-v1"
const MAX_FORMATTED_REQUEST_CHARS = 256 * 1024
const MAX_FORMATTED_SYSTEM_CHARS = 64 * 1024
const MAX_FORMATTED_MESSAGE_CHARS = 2 * 1024

/** Metadata attached to each diff entry. */
export interface DiffMeta {
  sessionID: string
  modelID: string
  providerID: string
  turn: number
  agent: string
  timestamp: number
}

/** Stored baseline for a session (previous request). */
interface Baseline {
  formatted: string
  meta: DiffMeta
}

/** Composite key: sessionID + modelID — prevents cross-model comparison. */
function prevKey(sessionID: string, modelID: string): string {
  return `${sessionID}:${modelID}`
}

/** Per-session+model baseline storage (in-memory — loaded from disk on first access). */
const prevMap = new Map<string, Baseline>()

/** Per-session diff counter for FIFO rotation. */
const countMap = new Map<string, number>()

/** Retrieve the previous request baseline for a session+model (in-memory only). */
export function getPrev(sessionID: string, modelID: string): Baseline | undefined {
  return prevMap.get(prevKey(sessionID, modelID))
}

/**
 * Store the current request as the next baseline for the session+model.
 * Updates in-memory cache AND fires async encrypted persistence to disk.
 */
export function storePrev(
  sessionID: string,
  modelID: string,
  formatted: string,
  meta: DiffMeta,
  projectID: string,
  worktree: string,
): void {
  const key = prevKey(sessionID, modelID)
  const baseline: Baseline = { formatted, meta }
  prevMap.set(key, baseline)

  // Fire-and-forget encrypted persistence (non-blocking — diff chain
  // resumes from scratch on next restart only if persistence fails).
  const filePath = baselinePath(sessionID, meta.providerID, meta.modelID)
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  deriveKey(projectID, worktree, sessionID).then((encKey) =>
    encryptBaseline(JSON.stringify(baseline), encKey).then((encrypted) => {
      fs.writeFileSync(filePath, encrypted)
    })
  ).catch(() => { /* persistence failure is non-critical */ })
}

/**
 * Format the LLM request (system prompt + model messages) as
 * a deterministic, human-readable text blob for diffing.
 */
export function formatRequest(
  system: string[],
  modelMsgs: ModelMessage[],
  meta: DiffMeta,
): string {
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

  pushLine("")
  pushLine("=== SYSTEM ===")
  for (const s of system) {
    if (!pushLine(truncateText(s, MAX_FORMATTED_SYSTEM_CHARS, "system entry"))) return lines.join("\n")
  }

  pushLine("")
  pushLine("=== MESSAGES ===")
  for (let i = 0; i < modelMsgs.length; i++) {
    if (!pushLine(formatModelMessage(modelMsgs[i], i))) break
  }

  return lines.join("\n")
}

/** Format a single ModelMessage for display. */
function formatModelMessage(msg: ModelMessage, index: number): string {
  return `[${msg.role}] #${index + 1}\n${truncateText(
    formatMessageContent(msg),
    MAX_FORMATTED_MESSAGE_CHARS,
    "message",
  )}`
}

function truncateText(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n... (${text.length - maxChars} more chars truncated from ${label})`
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
        const _exhaustive: never = part
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

/** Diff messages by content hash — show added, removed, and changed messages. */
function diffMessages(prev: string[], curr: string[]): string[] {
  const out: string[] = []
  out.push("@@ MESSAGES @@")

  // Group messages: each message starts with [role] #N
  const prevMsgs = splitMessages(prev)
  const currMsgs = splitMessages(curr)

  // Hash each message for comparison
  const prevHashes = prevMsgs.map((m) => hashString(m.join("\n")))
  const currHashes = currMsgs.map((m) => hashString(m.join("\n")))

  let added = 0
  let removed = 0

  // Simple diff: walk both arrays, identify additions/removals
  const pi = new Set(prevHashes)
  const ci = new Set(currHashes)

  // Check for purely added messages (in curr but not prev)
  const addedMsgs: number[] = []
  for (let i = 0; i < currMsgs.length; i++) {
    if (!pi.has(currHashes[i])) {
      addedMsgs.push(i)
      added++
    }
  }

  // Check for purely removed messages (in prev but not curr)
  const removedMsgs: number[] = []
  for (let i = 0; i < prevMsgs.length; i++) {
    if (!ci.has(prevHashes[i])) {
      removedMsgs.push(i)
      removed++
    }
  }

  if (added === 0 && removed === 0) return []

  out.push(`${added} added, ${removed} removed`)

  for (const idx of removedMsgs) {
    const header = prevMsgs[idx][0] // [role] #N
    out.push(`- ${header}`)
    // Show first 2 lines of content
    for (let l = 1; l < Math.min(prevMsgs[idx].length, 3); l++) {
      out.push(`-   ${prevMsgs[idx][l]}`)
    }
  }

  for (const idx of addedMsgs) {
    const header = currMsgs[idx][0] // [role] #N
    out.push(`+ ${header}`)
    // Show first 2 lines of content
    for (let l = 1; l < Math.min(currMsgs[idx].length, 3); l++) {
      out.push(`+   ${currMsgs[idx][l]}`)
    }
  }

  return out
}

/** Split message lines into per-message groups based on `[role] #N` headers. */
function splitMessages(lines: string[]): string[][] {
  const groups: string[][] = []
  let current: string[] = []

  for (const line of lines) {
    if (/^\[(user|assistant|tool|system)\]\s+#\d+$/.test(line)) {
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
 * Write a diff to the diffs/ folder.
 *
 * File naming: `{ISO8601-ms}_{provider}_{model}.diff`
 *
 * FIFO rotation: removes oldest diff when session exceeds MAX_DIFFS_PER_SESSION.
 *
 * Returns the absolute file path.
 */
/**
 * Write a diff to the flat log/ directory.
 *
 * Layout: `{data}/log/{time_ms}_diff_{model}_{sessionID}.diff`
 *
 * Encrypted baselines live in `log/.baselines/`.
 * FIFO rotation per session: removes oldest diff when exceeding MAX_DIFFS_PER_SESSION.
 */
export function writeDiff(diffContent: string, meta: DiffMeta): string {
  // FIFO rotation: track count per session
  const count = (countMap.get(meta.sessionID) ?? 0) + 1
  countMap.set(meta.sessionID, count)

  if (count > MAX_DIFFS_PER_SESSION) {
    const logDir = Global.Path.log
    const pattern = /^\d{13}_diff_.+\.diff$/
    const safeSid = sanitize(meta.sessionID)
    const files = fs.readdirSync(logDir)
      .filter((f) => pattern.test(f) && f.includes(`_${safeSid}.diff`))
      .sort()
    if (files.length > 0) {
      fs.unlinkSync(path.join(logDir, files[0]))
    }
  }

  const filepath = logPath("diff", meta.modelID, meta.sessionID, "diff")
  fs.writeFileSync(filepath, diffContent + EOL)
  return filepath
}

/** Sanitize a string for use in filenames. */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "-")
}

/** Escape regex special characters. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// ── Persistent baseline storage ───────────────────────────────────────────────

/** Directory path for persisted encrypted baselines. */
export function sessionDiffDir(_sessionID: string): string {
  return path.join(Global.Path.log, BASELINES_DIR)
}

/** File path for a persisted encrypted baseline. */
export function baselinePath(sessionID: string, providerID: string, modelID: string): string {
  const safeProvider = sanitize(providerID)
  const safeModel = sanitize(modelID)
  const safeSid = sanitize(sessionID)
  return path.join(Global.Path.log, BASELINES_DIR, `${safeProvider}_${safeModel}_${safeSid}.enc`)
}

/**
 * Derive an AES-256-GCM key from project+session identity.
 * Deterministic — same inputs always produce the same key.
 */
export async function deriveKey(
  projectID: string,
  worktree: string,
  sessionID: string,
): Promise<CryptoKey> {
  const material = `${projectID}:${worktree}:${sessionID}${KEY_DERIVATION_SALT}`
  const keyBytes = createHash("sha256").update(material).digest()
  return crypto.subtle.importKey("raw", new Uint8Array(keyBytes), "AES-GCM", false, ["encrypt", "decrypt"])
}

/** Encrypt a string with AES-256-GCM. Returns IV (12 bytes) prepended to ciphertext+authTag. */
export async function encryptBaseline(plaintext: string, key: CryptoKey): Promise<Buffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded))
  return Buffer.concat([Buffer.from(iv), Buffer.from(ciphertext)])
}

/** Decrypt an AES-256-GCM ciphertext (IV prepended format). */
export async function decryptBaseline(encrypted: Buffer, key: CryptoKey): Promise<string> {
  const iv = new Uint8Array(encrypted.subarray(0, 12))
  const ciphertext = new Uint8Array(encrypted.subarray(12))
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}

/**
 * Ensure a baseline exists in prevMap for this session+model.
 * On first call: checks memory, then attempts decryption from disk.
 * Later calls: memory hit — synchronous getPrev still works.
 */
export async function ensureBaseline(
  sessionID: string,
  modelID: string,
  providerID: string,
  projectID: string,
  worktree: string,
): Promise<void> {
  const key = prevKey(sessionID, modelID)
  if (prevMap.has(key)) return

  const filePath = baselinePath(sessionID, providerID, modelID)
  if (!fs.existsSync(filePath)) return

  try {
    const encKey = await deriveKey(projectID, worktree, sessionID)
    const encrypted = fs.readFileSync(filePath)
    const plaintext = await decryptBaseline(encrypted, encKey)
    const baseline: Baseline = JSON.parse(plaintext)
    prevMap.set(key, baseline)
  } catch {
    // Corrupt file or key mismatch — delete and start fresh
    try { fs.unlinkSync(filePath) } catch { /* best-effort cleanup */ }
  }
}

/**
 * Remove all persisted baselines for a session (called on session.delete).
 * Clears in-memory cache for all models within the session.
 */
export function deleteBaselines(sessionID: string): void {
  // Clear all model-variant keys for this session
  const prefix = `${sessionID}:`
  for (const key of prevMap.keys()) {
    if (key.startsWith(prefix)) prevMap.delete(key)
  }
  // Delete specific baselines for this session from the shared directory
  const baselinesDir = path.join(Global.Path.log, BASELINES_DIR)
  if (fs.existsSync(baselinesDir)) {
    const safeSid = sanitize(sessionID)
    try {
      const files = fs.readdirSync(baselinesDir)
      for (const file of files) {
        if (file.endsWith(`_${safeSid}.enc`)) {
          fs.unlinkSync(path.join(baselinesDir, file))
        }
      }
      if (fs.readdirSync(baselinesDir).length === 0) {
        fs.rmSync(baselinesDir, { recursive: true, force: true })
      }
    } catch { /* best-effort cleanup */ }
  }
}

export * as RequestDiff from "./request-diff"
