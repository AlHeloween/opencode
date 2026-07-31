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
    const nested =
      text.match(/^(?:sh|bash)(?:\.exe)?\s+-(?:c|lc)\s+([\s\S]+)$/i) ??
      text.match(/^cmd(?:\.exe)?\s+\/[ck]\s+([\s\S]+)$/i) ??
      text.match(
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
  if (
    /^git(?:\.exe)?\s+(?:(?:-C\s+\S+|--no-pager|-c\s+\S+|--work-tree=\S+|--git-dir=\S+)\s+)*ls-files\b/i.test(
      command,
    )
  )
    return true
  if (/^(?:echo|printf)\s+[^\n]*\*/i.test(command)) return true
  if (/^for\s+\w+\s+in\s+[^\n]*\*/i.test(command)) return true
  if (/^for\s+\/r\b/i.test(command)) return true
  if (/^for\s+%%?\w+\s+in\s+\(\*\)/i.test(command)) return true
  // Windows recursive where = file enum (not bare where.exe for PATH lookup)
  if (/^where(?:\.exe)?\s+\/r\b/i.test(command)) return true
  return false
}

/** True when shell is used for directory/file listing instead of list/glob/grep tools. */
export function isShellDirectoryBrowsing(command: string) {
  return shellSegments(command).some(isDirectoryBrowsingSegment)
}

/**
 * Constitution preflight for shell.
 * - shell directory enumeration: HARD BLOCK → use list/glob/grep tools
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
  tool: "edit" | "write" | "multiedit" | "apply_patch" | "applypatch"
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

/** Grounding set G: only Exact + Inferred (fresh) may anchor plans / MODIFY. */
export function isGroundingMark(mark: InfoMark): boolean {
  return mark === "Exact" || mark === "Inferred"
}

/** Parse free-form status tokens into InfoMark (unknown → Unknown). */
export function parseInfoMark(raw: string | undefined | null): InfoMark {
  if (!raw) return "Unknown"
  const t = raw.trim().toLowerCase()
  if (t === "exact") return "Exact"
  if (t === "inferred") return "Inferred"
  if (t === "hypothetical") return "Hypothetical"
  if (t === "guess") return "Guess"
  if (t === "unknown") return "Unknown"
  return "Unknown"
}

// ---------------------------------------------------------------------------
// Claim ledger — system-owned grounding (model cannot self-mint Exact)
// ---------------------------------------------------------------------------

export type ClaimRecord = {
  id: string
  text: string
  status: InfoMark
  reason?: string
  evidence?: string
  falsifier?: string
  /** System stamp required for Exact/Inferred promotion. */
  stamped: boolean
}

export type ClaimLedger = {
  claims: Map<string, ClaimRecord>
  /** Claim ids that may drive plan/MODIFY — must all be in G. */
  premises: string[]
  /** Hypothetical / open — must not drive MODIFY. */
  openQuestions: string[]
  /** True once a claim_ledger block was seen this session. */
  active: boolean
  updatedAt: number
}

type SessionEpistemic = {
  ledger: ClaimLedger
  /** claim_id → stamp meta (oracle PASS, session-read, …) */
  stamps: Map<string, { source: string; at: number }>
  /** Coarse floor for tools that do not use a ledger yet. */
  evidenceFloor: InfoMark
}

const sessionEpistemic = new Map<string, SessionEpistemic>()

function emptyLedger(): ClaimLedger {
  return {
    claims: new Map(),
    premises: [],
    openQuestions: [],
    active: false,
    updatedAt: Date.now(),
  }
}

function epistemic(sessionID: string): SessionEpistemic {
  let s = sessionEpistemic.get(sessionID)
  if (!s) {
    s = { ledger: emptyLedger(), stamps: new Map(), evidenceFloor: "Inferred" }
    sessionEpistemic.set(sessionID, s)
  }
  return s
}

/** Test / session teardown helper. */
export function resetEpistemicState(sessionID?: string) {
  if (sessionID) sessionEpistemic.delete(sessionID)
  else sessionEpistemic.clear()
}

export function getClaimLedger(sessionID: string): ClaimLedger {
  const led = epistemic(sessionID).ledger
  return {
    claims: new Map(led.claims),
    premises: [...led.premises],
    openQuestions: [...led.openQuestions],
    active: led.active,
    updatedAt: led.updatedAt,
  }
}

export function getEvidenceFloor(sessionID: string): InfoMark {
  return epistemic(sessionID).evidenceFloor
}

/**
 * Raise (never lower past Guess→Inferred→Exact) the coarse session floor.
 * Prefer per-claim stamps for decisions; floor is a fallback for nudges.
 */
export function raiseEvidenceFloor(sessionID: string, mark: InfoMark) {
  const s = epistemic(sessionID)
  if (infoMarkAtLeast(mark, s.evidenceFloor)) s.evidenceFloor = mark
}

/** System stamp → claim may legally hold Exact/Inferred (scoped). */
export function stampClaim(
  sessionID: string,
  claimID: string,
  source: string,
  status: InfoMark = "Exact",
) {
  const promoted: InfoMark = isGroundingMark(status) ? status : "Exact"
  const s = epistemic(sessionID)
  const id = claimID.trim()
  if (!id) return
  s.stamps.set(id, { source, at: Date.now() })
  const prev = s.ledger.claims.get(id)
  const next: ClaimRecord = {
    id,
    text: prev?.text ?? "",
    status: promoted,
    reason: prev?.reason,
    evidence: source,
    falsifier: prev?.falsifier,
    stamped: true,
  }
  s.ledger.claims.set(id, next)
  s.ledger.active = true
  s.ledger.updatedAt = Date.now()
  raiseEvidenceFloor(sessionID, next.status)
  log.debug("constitution.claim_stamp", { sessionID, claimID: id, source, status: next.status })
}

export function hasStamp(sessionID: string, claimID: string): boolean {
  return epistemic(sessionID).stamps.has(claimID.trim())
}

/** Premises ⊆ G (Exact|Inferred). Missing claim id = ungrounded. */
export function premisesGrounded(sessionID: string): {
  ok: boolean
  ungrounded: { id: string; status: InfoMark | "missing" }[]
} {
  const led = epistemic(sessionID).ledger
  if (!led.active || led.premises.length === 0) return { ok: true, ungrounded: [] }
  const ungrounded: { id: string; status: InfoMark | "missing" }[] = []
  for (const id of led.premises) {
    const c = led.claims.get(id)
    if (!c) {
      ungrounded.push({ id, status: "missing" })
      continue
    }
    if (!isGroundingMark(c.status)) ungrounded.push({ id, status: c.status })
  }
  return { ok: ungrounded.length === 0, ungrounded }
}

/** Floor = worst active premise status, else coarse evidenceFloor. */
export function decisionFloor(sessionID: string): InfoMark {
  const s = epistemic(sessionID)
  const led = s.ledger
  if (led.active && led.premises.length > 0) {
    let worst: InfoMark = "Exact"
    for (const id of led.premises) {
      const c = led.claims.get(id)
      const m: InfoMark = c?.status ?? "Unknown"
      if (!infoMarkAtLeast(m, worst)) worst = m
    }
    return worst
  }
  return s.evidenceFloor
}

/** Tools that mutate filesystem — hard-gated when premises ungrounded. */
export const MUTATION_TOOLS = new Set([
  "write",
  "edit",
  "multiedit",
  "apply_patch",
  "applypatch",
])

export function isMutationTool(tool: string): boolean {
  const t = tool.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (t === "write" || t === "edit" || t === "multiedit" || t === "applypatch") return true
  return MUTATION_TOOLS.has(tool)
}

/**
 * Hard gate: MODIFY denied when an active claim_ledger has premises outside G.
 * Soft path (no ledger): allow, rely on epistemicNudge.
 * Bypass: OPENCODE_BYPASS_GROUNDING=1 or OPENCODE_ALLOW_DESTRUCTIVE=1
 */
export function guardMutationGrounding(input: {
  sessionID: string
  tool: string
}): { blocked: boolean; message?: string } {
  if (!isMutationTool(input.tool)) return { blocked: false }
  if (process.env["OPENCODE_BYPASS_GROUNDING"] === "1") return { blocked: false }
  if (process.env["OPENCODE_ALLOW_DESTRUCTIVE"] === "1") return { blocked: false }

  const check = premisesGrounded(input.sessionID)
  if (check.ok) return { blocked: false }

  const detail = check.ungrounded
    .map((u) => `${u.id}=${u.status}`)
    .join(", ")
  const message =
    `[grounding gate: BLOCKED ${input.tool}] premises not in G (Exact|Inferred): ${detail}. ` +
    `Move ungrounded ids to open_questions, or promote via oracle_stamp / session-read / direct evidence ` +
    `(system stamp required — model self-[Exact] is rejected).`
  log.warn("constitution.grounding_block", {
    sessionID: input.sessionID,
    tool: input.tool,
    ungrounded: check.ungrounded,
  })
  return { blocked: true, message }
}

/**
 * Ingest claim_ledger + oracle_stamp blocks from assistant prose.
 * Model may set Guess|Hypothetical|Unknown freely.
 * Exact|Inferred only stick when a system stamp exists (or stamp is issued in same text).
 */
export function ingestAssistantText(sessionID: string, text: string): {
  ledgerUpdated: boolean
  stampsApplied: string[]
  demoted: string[]
} {
  const stampsApplied: string[] = []
  const demoted: string[] = []
  if (!text || text.length < 8) return { ledgerUpdated: false, stampsApplied, demoted }

  // oracle_stamp: claim_id: C1 / result: PASS  (YAML-ish or inline)
  for (const m of text.matchAll(
    /oracle_stamp\s*:\s*[\s\S]*?claim_id\s*:\s*["']?([A-Za-z0-9_.-]+)["']?[\s\S]*?result\s*:\s*["']?PASS["']?/gi,
  )) {
    const id = m[1]
    stampClaim(sessionID, id, "oracle_stamp:PASS", "Exact")
    stampsApplied.push(id)
  }
  // compact: oracle_stamp: C1 PASS
  for (const m of text.matchAll(/oracle_stamp\s*:\s*([A-Za-z0-9_.-]+)\s+PASS\b/gi)) {
    stampClaim(sessionID, m[1], "oracle_stamp:PASS", "Exact")
    stampsApplied.push(m[1])
  }

  const block = extractClaimLedgerBlock(text)
  if (!block) return { ledgerUpdated: stampsApplied.length > 0, stampsApplied, demoted }

  const parsed = parseClaimLedgerYaml(block)
  if (!parsed) return { ledgerUpdated: stampsApplied.length > 0, stampsApplied, demoted }

  const s = epistemic(sessionID)
  const next = emptyLedger()
  next.active = true
  next.premises = parsed.premises
  next.openQuestions = parsed.openQuestions

  for (const raw of parsed.claims) {
    let status = parseInfoMark(raw.status)
    let stamped = s.stamps.has(raw.id) || hasStamp(sessionID, raw.id)
    // Self-promotion ban: Exact/Inferred without stamp → Hypothetical
    if (isGroundingMark(status) && !stamped) {
      demoted.push(raw.id)
      status = "Hypothetical"
      stamped = false
      log.debug("constitution.self_exact_rejected", { sessionID, claimID: raw.id })
    }
    if (stamped && s.stamps.has(raw.id)) {
      // stamp wins: keep at least Exact
      const stampedStatus = s.ledger.claims.get(raw.id)?.status
      if (stampedStatus && isGroundingMark(stampedStatus)) status = stampedStatus
      else if (!isGroundingMark(status)) status = "Exact"
    }
    next.claims.set(raw.id, {
      id: raw.id,
      text: raw.text ?? "",
      status,
      reason: raw.reason,
      evidence: raw.evidence,
      falsifier: raw.falsifier,
      stamped,
    })
  }

  // Preserve prior stamped claims not re-listed
  for (const [id, c] of s.ledger.claims) {
    if (!next.claims.has(id) && c.stamped) next.claims.set(id, c)
  }

  s.ledger = next
  s.ledger.updatedAt = Date.now()
  log.debug("constitution.claim_ledger", {
    sessionID,
    premises: next.premises,
    open: next.openQuestions,
    n: next.claims.size,
    demoted,
  })
  return { ledgerUpdated: true, stampsApplied, demoted }
}

function extractClaimLedgerBlock(text: string): string | undefined {
  // fenced ```yaml ... claim_ledger
  const fence = text.match(/```(?:yaml|yml)?\s*\n([\s\S]*?claim_ledger\s*:[\s\S]*?)```/i)
  if (fence?.[1]) return fence[1]
  // bare claim_ledger: ... until blank line x2 or next top heading
  const idx = text.search(/claim_ledger\s*:/i)
  if (idx < 0) return undefined
  const slice = text.slice(idx)
  const end = slice.search(/\n#{1,3}\s|\n---\s*\n|\nclean_next_state\s*:/i)
  return end > 0 ? slice.slice(0, end) : slice.slice(0, 8000)
}

function parseClaimLedgerYaml(block: string): {
  claims: {
    id: string
    text?: string
    status: string
    reason?: string
    evidence?: string
    falsifier?: string
  }[]
  premises: string[]
  openQuestions: string[]
} | undefined {
  const claims: {
    id: string
    text?: string
    status: string
    reason?: string
    evidence?: string
    falsifier?: string
  }[] = []

  // Per-claim blocks: - id: C1
  const claimChunks = block.split(/\n\s*-\s+id\s*:/i).slice(1)
  for (const chunk of claimChunks) {
    const idM = chunk.match(/^\s*["']?([A-Za-z0-9_.-]+)["']?/)
    if (!idM) continue
    const id = idM[1]
    const field = (name: string) => {
      const m = chunk.match(new RegExp(`${name}\\s*:\\s*["']?([^\\n"']+)["']?`, "i"))
      return m?.[1]?.trim()
    }
    claims.push({
      id,
      text: field("text"),
      status: field("status") ?? "Unknown",
      reason: field("reason"),
      evidence: field("evidence"),
      falsifier: field("falsifier"),
    })
  }

  const listField = (name: string): string[] => {
    // premises_for_plan: [C1, C2] or premises: [C1]
    const m = block.match(new RegExp(`${name}\\s*:\\s*\\[([^\\]]*)\\]`, "i"))
    if (!m) return []
    return m[1]
      .split(",")
      .map((x) => x.replace(/["'\\s]/g, ""))
      .filter(Boolean)
  }

  const premises = listField("premises_for_plan").length
    ? listField("premises_for_plan")
    : listField("premises")
  const openQuestions = listField("open_questions").length
    ? listField("open_questions")
    : listField("open")

  if (claims.length === 0 && premises.length === 0) return undefined
  return { claims, premises, openQuestions }
}

/** Map tool name → floor upgrade (scoped evidence sources). */
export function evidenceUpgradeForTool(toolName: string): InfoMark | undefined {
  const t = toolName.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (t === "sessionread") return "Exact"
  if (t === "read" || t === "codegraph" || t === "codegraphexplore") return "Exact"
  if (t === "messagesearch" || t === "grep" || t === "glob" || t === "list") return "Inferred"
  return undefined
}

/** Epistemic nudge: advisory when floor not Exact (mutations / destructive). */
export function epistemicNudge(input: {
  tool: string
  evidenceFloor: InfoMark
  command?: string
  sessionID?: string
}): string | undefined {
  // Use decision floor (worst premise) when session ledger active; else turn floor.
  const effective = input.sessionID ? decisionFloor(input.sessionID) : input.evidenceFloor
  // If decision floor is Exact but turn floor is worse, still honor turn floor for nudge.
  const floor =
    infoMarkAtLeast(effective, input.evidenceFloor) ? effective : input.evidenceFloor

  if (floor === "Exact") return undefined

  const isMutation = isMutationTool(input.tool)
  const isDestructiveCmd = input.command
    ? classifyCommandRisk(input.command) === "DESTRUCTIVE"
    : false
  if (!isMutation && !isDestructiveCmd) return undefined

  const g = input.sessionID ? premisesGrounded(input.sessionID) : { ok: true, ungrounded: [] }
  const extra =
    !g.ok
      ? ` Ungrounded premises: ${g.ungrounded.map((u) => `${u.id}=${u.status}`).join(", ")}.`
      : ""

  return (
    `[epistemic nudge: decision based on ${floor} data.${extra} ` +
    `Only Exact|Inferred (system-stamped) may anchor MODIFY. ` +
    `session-read / oracle_stamp / direct read for Exact verification.]`
  )
}

export * as Constitution from "./constitution"