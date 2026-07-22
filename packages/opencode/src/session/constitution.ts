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

/**
 * Git ops that rewrite working tree / HEAD from VCS history.
 * These are NOT the same as edit-tool backups or Fossil snapshot restore:
 * - edit .bak  → one file, pre-edit content, session-scoped
 * - fossil restore → agent undo of working copy
 * - git checkout/switch/restore/reset --hard → can wipe many files and
 *   erase uncommitted multi-commit work into unreadable chaos
 *
 * HARD-BLOCKED for agents (not permission-askable) unless
 * OPENCODE_ALLOW_DESTRUCTIVE=1. Never use git checkout to "fix one file".
 */
const GIT_HISTORY_REWRITE_PATTERNS: RegExp[] = [
  /\bgit\s+checkout\b/i,
  /\bgit\s+switch\b/i,
  /\bgit\s+restore\b/i,
  /\bgit\s+reset\s+--hard\b/i,
]

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive\s+--force)/i,
  /\brm\s+-rf\b/i,
  /\bgit\s+push\b[^\n]*--force\b/i,
  /\bgit\s+push\b[^\n]*-f\b/i,
  ...GIT_HISTORY_REWRITE_PATTERNS,
  /\bgit\s+clean\s+-[a-zA-Z]*f/i,
  /\bdrop\s+(table|database)\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd/i,
  /\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force/i,
  /\bRemove-Item\b[^\n]*-Force[^\n]*-Recurse/i,
]

export function isGitHistoryRewrite(command: string): boolean {
  return GIT_HISTORY_REWRITE_PATTERNS.some((re) => re.test(command.trim()))
}

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

/** Opt-out: OPENCODE_ALLOW_DESTRUCTIVE=1|true|yes permits DESTRUCTIVE shell. */
export function allowDestructiveCommands(): boolean {
  const v = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
  if (!v) return false
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes"
}

/**
 * Classify a shell command's risk for logging / hard gates.
 * Does not replace the permission system — constitution layer on top.
 */
export function classifyCommandRisk(command: string): Risk {
  const text = command.trim()
  if (!text) return "LOW"
  if (DESTRUCTIVE_PATTERNS.some((re) => re.test(text))) return "DESTRUCTIVE"
  if (ELEVATED_PATTERNS.some((re) => re.test(text))) return "ELEVATED"
  return "LOW"
}

export type CommandGuardResult = {
  risk: Risk
  /**
   * When true, caller must obtain user approval via permission
   * `destructive` (not `bash`, so bash:* allow rules cannot auto-pass).
   */
  needsDestructivePermission: boolean
  /** Hard block without permission UI (legacy message only). */
  blocked: boolean
  message?: string
}

/**
 * Constitution preflight for shell.
 * - git checkout/switch/restore/reset --hard: HARD BLOCK (not askable) unless
 *   OPENCODE_ALLOW_DESTRUCTIVE=1 — agents must use edit-backup / fossil restore
 * - other DESTRUCTIVE: needs permission "destructive" unless env allow
 * - ELEVATED: log only
 */
export function guardCommand(
  command: string,
  meta?: { sessionID?: string; agent?: string },
): CommandGuardResult {
  const risk = classifyCommandRisk(command)
  if (risk === "LOW") {
    return { risk, needsDestructivePermission: false, blocked: false }
  }

  const allow = allowDestructiveCommands()
  log.warn("constitution.command_risk", {
    risk,
    command: command.slice(0, 200),
    sessionID: meta?.sessionID,
    agent: meta?.agent,
    allowDestructive: allow,
    gitHistoryRewrite: isGitHistoryRewrite(command),
  })

  // Hard block: VCS working-tree rewrite. Edit tool has .bak per file; Fossil has
  // session undo. git checkout of "one file" can still move/discard a whole tree
  // of uncommitted work — recovery becomes random chaos. Do not permission-ask.
  if (isGitHistoryRewrite(command) && !allow) {
    return {
      risk: "DESTRUCTIVE",
      needsDestructivePermission: false,
      blocked: true,
      message:
        "constitution: BLOCKED git checkout/switch/restore/reset --hard. " +
        "Do NOT use git to undo a file — that can wipe unrelated working-tree changes " +
        "and scramble multi-commit state. " +
        "Recover with: edit-tool .bak backups, or Fossil snapshot restore. " +
        "Only set OPENCODE_ALLOW_DESTRUCTIVE=1 if you truly intend VCS rewrite.",
    }
  }

  if (risk === "DESTRUCTIVE" && !allow) {
    return {
      risk,
      needsDestructivePermission: true,
      blocked: false,
      message:
        "constitution: DESTRUCTIVE command requires explicit approval " +
        "(rm -rf, git push --force, …). " +
        "Or set OPENCODE_ALLOW_DESTRUCTIVE=1.",
    }
  }
  return { risk, needsDestructivePermission: false, blocked: false }
}

/** @deprecated prefer guardCommand */
export function noteCommandRisk(command: string, meta?: { sessionID?: string; agent?: string }): Risk {
  return guardCommand(command, meta).risk
}

/** File mutation is always at least ELEVATED (persistent write). */
export function noteMutationRisk(input: {
  tool: "edit" | "write" | "multiedit" | "apply_patch"
  path: string
  sessionID?: string
}): Risk {
  const risk: Risk = "ELEVATED"
  log.debug("constitution.mutation_risk", {
    risk,
    tool: input.tool,
    path: input.path.slice(0, 240),
    sessionID: input.sessionID,
  })
  return risk
}

/** Banner for Exact archive retrieval (session-read). */
export function sessionReadExactBanner(sessionID: string): string {
  return (
    `## Session: ${sessionID}\n` +
    `info_mark: Exact — ground-truth archive (not a summary).\n` +
    `Prefer these IDs over Inferred compaction text when resolving conflicts.\n`
  )
}

/** True if left is at least as certain as right (Exact beats Guess). */
export function infoMarkAtLeast(left: InfoMark, right: InfoMark): boolean {
  return INFO_MARK_ORDER.indexOf(left) <= INFO_MARK_ORDER.indexOf(right)
}

/** Tools that mutate filesystem or state — always ELEVATED risk. */
const MUTATION_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch"])

/** Epistemic nudge: injected before a destructive tool when evidence floor
  * is not Exact (i.e. model is acting on Inferred/Guess data without
  * verifying via session-read first).  Not a hard gate — advisory only. */
export function epistemicNudge(input: {
  tool: string
  evidenceFloor: InfoMark
  command?: string
}): string | undefined {
  if (input.evidenceFloor === "Exact") return undefined

  const isMutation = MUTATION_TOOLS.has(input.tool)
  const isDestructiveCmd = input.command
    ? classifyCommandRisk(input.command) === "DESTRUCTIVE"
    : false
  if (!isMutation && !isDestructiveCmd) return undefined

  return (
    `[epistemic nudge: decision based on ${input.evidenceFloor} data. ` +
    `session-read recommended for Exact verification.]`
  )
}

export * as Constitution from "./constitution"
