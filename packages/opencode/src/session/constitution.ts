/**
 * Thin runtime mirror of reasoning-kernel constitution concepts.
 *
 * Python (`opencode_prompts_kernel.py`) designs the algorithm; this module
 * applies a subset at tool time — risk ranks and InfoMarks — without dragging
 * the full kernel into TypeScript.
 *
 * [KV-CACHE SAFE] — pure functions; never mutate system prompts.
 */
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "session.constitution" })

/** Epistemic rank — aligned with InfoMarkLevel in the Python kernel. */
export type InfoMark = "Exact" | "Inferred" | "Hypothetical" | "Guess" | "Unknown"

/** Write / process risk — aligned with kernel Risk enum (subset). */
export type Risk = "LOW" | "ELEVATED" | "DESTRUCTIVE"

export const INFO_MARK_ORDER: readonly InfoMark[] = [
  "Exact",
  "Inferred",
  "Hypothetical",
  "Guess",
  "Unknown",
] as const

/** Rank of memory surfaces for continuous compaction. */
export const MEMORY_INFO_MARK = {
  /** session-read with a concrete message ID */
  sessionRead: "Exact" as InfoMark,
  /** algorithmic / model summary text */
  summary: "Inferred" as InfoMark,
  /** message* recent fold without re-read */
  messageStarRecent: "Inferred" as InfoMark,
  /** unaided model recall */
  unaided: "Guess" as InfoMark,
} as const

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive\s+--force)/i,
  /\brm\s+-rf\b/i,
  /\bgit\s+push\b[^\n]*--force\b/i,
  /\bgit\s+push\b[^\n]*-f\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-zA-Z]*f/i,
  /\bdrop\s+(table|database)\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd/i,
]

const ELEVATED_PATTERNS: RegExp[] = [
  /\bgit\s+push\b/i,
  /\bgit\s+commit\b/i,
  /\bnpm\s+publish\b/i,
  /\bbun\s+publish\b/i,
  /\bdocker\s+(rm|rmi|system\s+prune)\b/i,
  /\b(chmod|chown)\b/i,
  /\b(kubectl|helm)\s+delete\b/i,
  /\bRemove-Item\b/i,
  /\bdel\s+\/[sq]/i,
  /\brmdir\b/i,
]

/**
 * Classify a shell command's risk for logging / future hard gates.
 * Does not replace permission system — constitution layer on top.
 */
export function classifyCommandRisk(command: string): Risk {
  const text = command.trim()
  if (!text) return "LOW"
  if (DESTRUCTIVE_PATTERNS.some((re) => re.test(text))) return "DESTRUCTIVE"
  if (ELEVATED_PATTERNS.some((re) => re.test(text))) return "ELEVATED"
  return "LOW"
}

/** Log constitution risk; returns risk for callers that want soft policy. */
export function noteCommandRisk(command: string, meta?: { sessionID?: string; agent?: string }): Risk {
  const risk = classifyCommandRisk(command)
  if (risk === "LOW") return risk
  log.warn("constitution.command_risk", {
    risk,
    command: command.slice(0, 200),
    sessionID: meta?.sessionID,
    agent: meta?.agent,
  })
  return risk
}

/** True if left is at least as certain as right (Exact beats Guess). */
export function infoMarkAtLeast(left: InfoMark, right: InfoMark): boolean {
  return INFO_MARK_ORDER.indexOf(left) <= INFO_MARK_ORDER.indexOf(right)
}

export * as Constitution from "./constitution"
