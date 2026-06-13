/**
 * KV Cache Diff Logging.
 *
 * Formats LLM requests (system + model messages) as diffable text,
 * computes unified diffs between consecutive turns, and writes .diff
 * files to the `diffs/` folder for cache miss debugging.
 *
 * [KV-CACHE SAFE] — pure read-side logging, zero impact on provider request bytes.
 */
import path from "path"
import fs from "fs"
import type { ModelMessage } from "ai"
import { Global } from "@opencode-ai/core/global"
import { unifiedDiff } from "@/util/unified-diff"

const DIFFS_DIR = "diffs"
const MAX_DIFFS_PER_SESSION = 200

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

/** Per-session baseline storage (in-memory — does not survive restart). */
const prevMap = new Map<string, Baseline>()

/** Per-session diff counter for FIFO rotation. */
const countMap = new Map<string, number>()

/** Retrieve the previous request baseline for a session. */
export function getPrev(sessionID: string): Baseline | undefined {
  return prevMap.get(sessionID)
}

/** Store the current request as the next baseline for the session. */
export function storePrev(sessionID: string, formatted: string, meta: DiffMeta): void {
  prevMap.set(sessionID, { formatted, meta })
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

  lines.push("=== META ===")
  lines.push(`session: ${meta.sessionID}`)
  lines.push(`model: ${meta.providerID}/${meta.modelID}`)
  lines.push(`agent: ${meta.agent}`)
  lines.push(`turn: ${meta.turn}`)
  lines.push(`timestamp: ${new Date(meta.timestamp).toISOString()}`)

  lines.push("")
  lines.push("=== SYSTEM ===")
  for (const s of system) {
    lines.push(s)
  }

  lines.push("")
  lines.push("=== MESSAGES ===")
  for (let i = 0; i < modelMsgs.length; i++) {
    const msg = modelMsgs[i]
    lines.push(formatModelMessage(msg, i))
  }

  return lines.join("\n")
}

/** Format a single ModelMessage for display. */
function formatModelMessage(msg: ModelMessage, index: number): string {
  const header = `[${msg.role}] #${index + 1}`

  const contentStr = formatMessageContent(msg)

  // Truncate very long tool outputs to keep diffs manageable
  const truncated = contentStr.length > 4000
    ? contentStr.slice(0, 4000) + `\n... (${contentStr.length - 4000} more chars)`
    : contentStr

  return `${header}\n${truncated}`
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
        if (part.type === "text") return `[text] ${part.text}`
        if (part.type === "reasoning") return `[reasoning] ${part.text}`
        if (part.type === "tool-call") {
          return `[tool-call:${part.toolName}] id=${part.toolCallId} input=${JSON.stringify(part.input)}`
        }
        if (part.type === "tool-result") {
          const output = typeof part.output === "string" ? part.output : JSON.stringify(part.output)
          return `[tool-result:${part.toolName}] id=${part.toolCallId}\n${output}`
        }
        if (part.type === "image") return `[image] ${typeof part.image === "string" ? part.image : "<binary>"}`
        if (part.type === "file") return `[file] ${part.filename ?? JSON.stringify(part.data)}`
        if (part.type === "tool-approval-request") return `[tool-approval-request] approvalId=${part.approvalId} toolCallId=${part.toolCallId}`
        if (part.type === "tool-approval-response") return `[tool-approval-response] approvalId=${part.approvalId} approved=${part.approved}`
        // Exhaustive: all known part types handled above
        const _exhaustive: never = part
        return `[${(_exhaustive as { type: string }).type}]`
      })
      .join("\n")
  }

  return JSON.stringify(content)
}

/**
 * Compute a unified diff between two formatted requests.
 * Returns empty string when `prev` is null (first turn of session).
 */
export function diffRequest(
  prev: string | undefined,
  curr: string,
  prevMeta: DiffMeta | undefined,
  currMeta: DiffMeta,
): string {
  if (!prev || !prevMeta) return ""

  const prevLabel = `turn-${prevMeta.turn}  ${new Date(prevMeta.timestamp).toISOString()}`
  const currLabel = `turn-${currMeta.turn}  ${new Date(currMeta.timestamp).toISOString()}`

  return unifiedDiff(prev, curr, prevLabel, currLabel)
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
export function writeDiff(diffContent: string, meta: DiffMeta): string {
  const diffsDir = path.join(Global.Path.home, DIFFS_DIR)
  fs.mkdirSync(diffsDir, { recursive: true })

  // FIFO rotation: track count per session
  const count = (countMap.get(meta.sessionID) ?? 0) + 1
  countMap.set(meta.sessionID, count)

  if (count > MAX_DIFFS_PER_SESSION) {
    // Delete oldest diff for this session
    const pattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z_${escapeRegExp(meta.providerID)}_${escapeRegExp(meta.modelID)}\\.diff$`)
    const files = fs.readdirSync(diffsDir)
      .filter((f) => pattern.test(f))
      .sort() // chronological order (ISO8601 sorts correctly)
    if (files.length > 0) {
      fs.unlinkSync(path.join(diffsDir, files[0]))
    }
  }

  // Build filename: ISO8601-ms_provider_model.diff
  const d = new Date(meta.timestamp)
  const pad = (n: number, len = 2) => String(n).padStart(len, "0")
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}Z`
  const safeProvider = sanitize(meta.providerID)
  const safeModel = sanitize(meta.modelID)
  const filename = `${iso}_${safeProvider}_${safeModel}.diff`

  const filepath = path.join(diffsDir, filename)
  fs.writeFileSync(filepath, diffContent + "\n")
  return filepath
}

/** Sanitize a string for use in filenames. */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_")
}

/** Escape regex special characters. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export * as RequestDiff from "./request-diff"


