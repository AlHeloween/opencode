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
 * Four independent permission buckets (do not share settings):
 *   destructive-file   — filesystem wipe (rm -rf, …)
 *   destructive-db     — drop table/database, …
 *   destructive-git    — git rewrite / force-push / clean -f / stash pop
 *   destructive-fossil — agent fossil CLI mutate (snapshot is runtime-only)
 *
 * Hard-blocked families never use the permission dialog (blocked: true) unless
 * OPENCODE_ALLOW_DESTRUCTIVE / bypass_constitution. Askable ones use the
 * matching permission key so policies never cross-contaminate.
 */
export type DestructiveKind = "file" | "db" | "git" | "fossil"

export type DestructivePermission =
  | "destructive-file"
  | "destructive-db"
  | "destructive-git"
  | "destructive-fossil"

export function destructivePermission(kind: DestructiveKind): DestructivePermission {
  return `destructive-${kind}`
}

/** Git ops that rewrite working tree / HEAD — HARD BLOCK (not askable). */
const GIT_HISTORY_REWRITE_PATTERNS: RegExp[] = [
  /\bgit\s+checkout\b/i,
  /\bgit\s+switch\b/i,
  /\bgit\s+restore\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+stash\s+pop\b/i,
  /\bgit\s+stash\s+apply\b/i,
  /\bgit\s+stash\s+drop\b/i,
  /\bgit\s+stash\s+clear\b/i,
  /\bgit\s+stash\s+branch\b/i,
]

/** Git DESTRUCTIVE that still go through permission destructive-git. */
const GIT_ASKABLE_DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bgit\s+push\b[^\n]*--force\b/i,
  /\bgit\s+push\b[^\n]*-f\b/i,
  /\bgit\s+clean\s+-[a-zA-Z]*f/i,
]

/** Agent fossil CLI mutate — HARD BLOCK (snapshot is runtime-only). */
const FOSSIL_AGENT_MUTATE_PATTERNS: RegExp[] = [
  /\bfossil(\.exe)?\s+commit\b/i,
  /\bfossil(\.exe)?\s+ci\b/i,
  /\bfossil(\.exe)?\s+add\b/i,
  /\bfossil(\.exe)?\s+rm\b/i,
  /\bfossil(\.exe)?\s+delete\b/i,
  /\bfossil(\.exe)?\s+addremove\b/i,
  /\bfossil(\.exe)?\s+checkout\b/i,
  /\bfossil(\.exe)?\s+co\b/i,
  /\bfossil(\.exe)?\s+update\b/i,
  /\bfossil(\.exe)?\s+up\b/i,
  /\bfossil(\.exe)?\s+merge\b/i,
  /\bfossil(\.exe)?\s+undo\b/i,
  /\bfossil(\.exe)?\s+revert\b/i,
  /\bfossil(\.exe)?\s+close\b/i,
  /\bfossil(\.exe)?\s+open\b/i,
  /\bfossil(\.exe)?\s+push\b/i,
  /\bfossil(\.exe)?\s+pull\b/i,
  /\bfossil(\.exe)?\s+sync\b/i,
]

/** Filesystem / disk wipe — permission destructive-file. */
const FILE_DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive\s+--force)/i,
  /\brm\s+-rf\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd/i,
  /\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force/i,
  /\bRemove-Item\b[^\n]*-Force[^\n]*-Recurse/i,
]

/** Database schema destruction — permission destructive-db (separate from files). */
const DB_DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bdrop\s+(table|database|schema|index|view)\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\b/i, // bulk delete; still gated — prefer app-level tools
]

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  ...FILE_DESTRUCTIVE_PATTERNS,
  ...DB_DESTRUCTIVE_PATTERNS,
  ...GIT_HISTORY_REWRITE_PATTERNS,
  ...GIT_ASKABLE_DESTRUCTIVE_PATTERNS,
  ...FOSSIL_AGENT_MUTATE_PATTERNS,
]

export function isGitHistoryRewrite(command: string): boolean {
  return GIT_HISTORY_REWRITE_PATTERNS.some((re) => re.test(command.trim()))
}

export function isFossilAgentMutate(command: string): boolean {
  return FOSSIL_AGENT_MUTATE_PATTERNS.some((re) => re.test(command.trim()))
}

export function isFileDestructive(command: string): boolean {
  return FILE_DESTRUCTIVE_PATTERNS.some((re) => re.test(command.trim()))
}

export function isDbDestructive(command: string): boolean {
  return DB_DESTRUCTIVE_PATTERNS.some((re) => re.test(command.trim()))
}

export function isGitAskableDestructive(command: string): boolean {
  return GIT_ASKABLE_DESTRUCTIVE_PATTERNS.some((re) => re.test(command.trim()))
}

/** Map command → permission family (null if not DESTRUCTIVE). */
export function classifyDestructiveKind(command: string): DestructiveKind | null {
  const text = command.trim()
  if (!text) return null
  if (isFossilAgentMutate(text)) return "fossil"
  if (isGitHistoryRewrite(text) || isGitAskableDestructive(text)) return "git"
  if (isDbDestructive(text)) return "db"
  if (isFileDestructive(text)) return "file"
  if (DESTRUCTIVE_PATTERNS.some((re) => re.test(text))) return "file"
  return null
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

function unquote(command: string) {
  const text = command.trim()
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).trim()
  }
  return text
}

function unwrapShellCommand(command: string) {
  let text = unquote(command)
  for (let index = 0; index < 4; index++) {
    const nested = text.match(/^(?:sh|bash)(?:\.exe)?\s+-(?:c|lc)\s+([\s\S]+)$/i)
      ?? text.match(/^cmd(?:\.exe)?\s+\/[ck]\s+([\s\S]+)$/i)
      ?? text.match(
        /^(?:powershell|pwsh)(?:\.exe)?\s+(?:(?:-NoProfile|-NoLogo|-NonInteractive)\s+|-ExecutionPolicy\s+\S+\s+)*-(?:Command|c)\s+([\s\S]+)$/i,
      )
    if (nested) {
      text = unquote(nested[1] ?? "")
      continue
    }
    const sudo = text.match(
      /^sudo(?:(?:\s+(?:-u|-g|-h|-p|-r|-t|-C)\s+\S+)|(?:\s+(?:-E|-H|-K|-b|-n|-s|--preserve-env|--reset-timestamp)))*\s+([\s\S]+)$/i,
    )
    if (sudo) {
      text = unquote(sudo[1] ?? "")
      continue
    }
    const commandWrapper = text.match(/^command(?:\s+--)?\s+([\s\S]+)$/i)
    if (commandWrapper) {
      text = unquote(commandWrapper[1] ?? "")
      continue
    }
    const env = text.match(/^env(?:\s+-i)*(?:(?:\s+[A-Za-z_][A-Za-z0-9_]*=\S+))*\s+([\s\S]+)$/i)
    if (env) {
      text = unquote(env[1] ?? "")
      continue
    }
    return text
  }
  return text
}

function shellSegments(command: string) {
  const segments: string[] = []
  let current = ""
  let quote: "'" | '"' | undefined
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (quote) {
      current += char
      if (char === "\\" && quote === '"' && command[index + 1]) {
        current += command[index + 1]
        index++
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    if (char === ";" || char === "|" || char === "\n" || (char === "&" && command[index + 1] === "&")) {
      if (current.trim()) segments.push(current)
      current = ""
      if (char === "&" || char === "|") index++
      continue
    }
    current += char
  }
  if (current.trim()) segments.push(current)
  return segments.map(unwrapShellCommand).filter(Boolean)
}

function isDirectoryBrowsingSegment(command: string) {
  if (/^(?:(?:\/usr)?\/bin\/)?(?:ls|dir|tree)(?:\.exe)?(?:\s|$)/i.test(command)) return true
  if (/^(?:find|fd|fdfind)(?:\.exe)?(?:\s|$)/i.test(command)) return true
  if (/^busybox\s+(?:ls|find)\b/i.test(command)) return true
  if (/^(?:Get-ChildItem|gci|Microsoft\.PowerShell\.Management\\Get-ChildItem)\b/i.test(command)) return true
  if (/^(?:Get-Item|Resolve-Path)\b[^\n]*\*/i.test(command)) return true
  if (/^rg(?:\.exe)?\b(?=[^\n]*\s--files\b)/i.test(command)) return true
  if (/^git(?:\.exe)?\s+(?:(?:-C\s+\S+|--no-pager|-c\s+\S+|--work-tree=\S+|--git-dir=\S+)\s+)*ls-files\b/i.test(command)) return true
  if (/^(?:echo|printf)\s+[^\n]*\*/i.test(command)) return true
  if (/^for\s+\w+\s+in\s+[^\n]*\*/i.test(command)) return true
  if (/^for\s+\/r\b/i.test(command)) return true
  if (/^for\s+%%?\w+\s+in\s+\(\*\)/i.test(command)) return true
  return /^where(?:\.exe)?\s+\/r\b/i.test(command)
}

export function isShellDirectoryBrowsing(command: string) {
  return shellSegments(command).some(isDirectoryBrowsingSegment)
}

/** Opt-out: OPENCODE_ALLOW_DESTRUCTIVE=1|true|yes permits DESTRUCTIVE shell. */
export function allowDestructiveCommands(): boolean {
  const v = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
  if (v && (v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes")) return true
  // Config-driven bypass via bypass_constitution in config.json
  const b = process.env["OPENCODE_BYPASS_CONSTITUTION"]
  if (b && (b === "1" || b.toLowerCase() === "true" || b.toLowerCase() === "yes")) return true
  return false
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
  /** Which independent policy bucket (file | git | fossil). */
  kind?: DestructiveKind
  /** Permission key to ask (destructive-file|git|fossil) when needsDestructivePermission. */
  permission?: DestructivePermission
  /**
   * When true, caller must obtain user approval via permission
   * `destructive-file` | `destructive-git` | `destructive-fossil`
   * (not bash:*, so shell wildcards cannot auto-pass).
   */
  needsDestructivePermission: boolean
  /** Hard block without permission UI. */
  blocked: boolean
  message?: string
}

/**
 * Constitution preflight for shell.
 * - git rewrite / stash pop: HARD BLOCK unless env bypass
 * - fossil mutate CLI: HARD BLOCK unless env bypass
 * - askable: permission destructive-file | destructive-db | destructive-git
 * - ELEVATED: log only
 */
export function guardCommand(
  command: string,
  meta?: { sessionID?: string; agent?: string },
): CommandGuardResult {
  if (isShellDirectoryBrowsing(command)) {
    log.warn("constitution.directory_browsing_blocked", {
      command: command.slice(0, 200),
      sessionID: meta?.sessionID,
      agent: meta?.agent,
    })
    return {
      risk: "LOW",
      needsDestructivePermission: false,
      blocked: true,
      message:
        "constitution: BLOCKED shell directory/file enumeration. Use the list tool for browsing; " +
        "use glob for path-pattern matching or grep for content search.",
    }
  }
  const risk = classifyCommandRisk(command)
  if (risk === "LOW") {
    return { risk, needsDestructivePermission: false, blocked: false }
  }

  const kind = classifyDestructiveKind(command) ?? undefined
  const allow = allowDestructiveCommands()
  log.warn("constitution.command_risk", {
    risk,
    kind,
    command: command.slice(0, 200),
    sessionID: meta?.sessionID,
    agent: meta?.agent,
    allowDestructive: allow,
    gitHistoryRewrite: isGitHistoryRewrite(command),
  })

  if (risk === "ELEVATED") {
    return { risk, kind, needsDestructivePermission: false, blocked: false }
  }

  // Hard block: git rewrite family
  if (isGitHistoryRewrite(command) && !allow) {
    return {
      risk: "DESTRUCTIVE",
      kind: "git",
      permission: "destructive-git",
      needsDestructivePermission: false,
      blocked: true,
      message:
        "constitution: BLOCKED git checkout/switch/restore/reset --hard/stash pop|apply|drop|clear " +
        "(permission group: destructive-git). " +
        "Do NOT use git to undo or re-layer WIP — that can wipe uncommitted work. " +
        "Recover with: edit-tool .bak or Fossil snapshot restore. " +
        "Only set OPENCODE_ALLOW_DESTRUCTIVE=1 / bypass_constitution if you truly intend VCS rewrite.",
    }
  }

  // Hard block: fossil mutate
  if (isFossilAgentMutate(command) && !allow) {
    return {
      risk: "DESTRUCTIVE",
      kind: "fossil",
      permission: "destructive-fossil",
      needsDestructivePermission: false,
      blocked: true,
      message:
        "constitution: BLOCKED fossil CLI mutate (permission group: destructive-fossil). " +
        "Fossil is automatic session undo/snapshot — not project VCS. " +
        "Use git for project history. Override only OPENCODE_ALLOW_DESTRUCTIVE=1 / bypass_constitution.",
    }
  }

  if (risk === "DESTRUCTIVE" && !allow) {
    const k = kind ?? "file"
    const perm = destructivePermission(k)
    return {
      risk,
      kind: k,
      permission: perm,
      needsDestructivePermission: true,
      blocked: false,
      message:
        `constitution: DESTRUCTIVE (${perm}) requires explicit approval ` +
        `(rm -rf → destructive-file; DROP TABLE → destructive-db; force-push → destructive-git). ` +
        "Or set OPENCODE_ALLOW_DESTRUCTIVE=1 / bypass_constitution.",
    }
  }
  return { risk, kind, needsDestructivePermission: false, blocked: false }
}

/** @deprecated prefer guardCommand */
export function noteCommandRisk(command: string, meta?: { sessionID?: string; agent?: string }): Risk {
  return guardCommand(command, meta).risk
}

/** File mutation is always at least ELEVATED (persistent write). */
export function noteMutationRisk(input: {
  tool: "edit" | "write" | "multiedit" | "applypatch"
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
const MUTATION_TOOLS = new Set(["write", "edit", "multiedit", "applypatch"])

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
    `sessionread recommended for Exact verification.]`
  )
}

export * as Constitution from "./constitution"
