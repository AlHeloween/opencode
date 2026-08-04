/**
 * Runtime constitution — aligned with prompts_kernel v6.0.
 *
 * Single source of truth for: risk tiers, command classification,
 * shell browsing guard, destructive guard, mutation grounding.
 *
 * [KV-CACHE SAFE] — pure functions; never mutate system prompts.
 */
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "session.constitution" })

// ============================================================================
// ENUMS — single source, no string-union sub-modalities
// ============================================================================

/** Epistemic rank — aligned with InfoMarkLevel in the Python kernel. */
export type InfoMark = "Exact" | "Inferred" | "Hypothetical" | "Guess" | "Unknown"

/** Write / process risk — aligned with kernel Risk enum (v6.0: +CRITICAL). */
export type Risk = "LOW" | "ELEVATED" | "DESTRUCTIVE" | "CRITICAL"

/** Command family for classification + blocking policy. */
export const CommandFamily = {
  /** Allowed — no block, no permission needed. */
  ALLOWED: "ALLOWED",
  /** Shell FS enumerator — HARD BLOCK (use list/glob/grep tools). */
  FILE_ENUMERATOR: "FILE_ENUMERATOR",
  /** File deletion / disk wipe — permission destructive-file. */
  FILE_DESTRUCTIVE: "FILE_DESTRUCTIVE",
  /** Database schema destruction — permission destructive-db. */
  DB_DESTRUCTIVE: "DB_DESTRUCTIVE",
  /** Git working-tree rewrite — HARD BLOCK. */
  GIT_HISTORY_REWRITE: "GIT_HISTORY_REWRITE",
  /** Git askable destructive (force-push, clean -f) — permission destructive-git. */
  GIT_ASKABLE_DESTRUCTIVE: "GIT_ASKABLE_DESTRUCTIVE",
  /** Fossil CLI mutate — HARD BLOCK. */
  FOSSIL_MUTATE: "FOSSIL_MUTATE",
  /** Elevated-risk operations (log, don't block). */
  ELEVATED_GENERAL: "ELEVATED_GENERAL",
} as const
export type CommandFamily = (typeof CommandFamily)[keyof typeof CommandFamily]

/** Independent permission buckets (do not share settings). */
export const PermissionBucket = {
  FILE: "destructive-file",
  DB: "destructive-db",
  GIT: "destructive-git",
  FOSSIL: "destructive-fossil",
} as const
export type PermissionBucket = (typeof PermissionBucket)[keyof typeof PermissionBucket]

// ============================================================================
// INFO MARK — memory surfaces + ordering
// ============================================================================

export const INFO_MARK_ORDER: readonly InfoMark[] = [
  "Exact",
  "Inferred",
  "Hypothetical",
  "Guess",
  "Unknown",
] as const

export const MEMORY_INFO_MARK = {
  sessionRead: "Exact" as InfoMark,
  summary: "Inferred" as InfoMark,
  messageStarRecent: "Inferred" as InfoMark,
  unaided: "Guess" as InfoMark,
} as const

// ============================================================================
// UNIFIED COMMAND CLASSIFICATION TABLE
// ============================================================================

type CommandEntry = {
  family: CommandFamily
  risk: Risk
  hardBlock: boolean
  permission?: PermissionBucket
  patterns: RegExp[]
}

/** Single classification table — one entry per command family. */
const COMMAND_TABLE: CommandEntry[] = [
  // ── Tier 1: pure FS enumerators — HARD BLOCK (list/glob/grep exist) ──
  {
    family: CommandFamily.FILE_ENUMERATOR,
    risk: "LOW",
    hardBlock: true,
    patterns: [
      // Directory listing (list tool)
      /^(?:(?:\/usr)?\/bin\/)?(?:ls|dir|tree)(?:\.exe)?(?:\s|$)/i,
      /^(?:Get-ChildItem|gci)\b/i,
      /^busybox\s+(?:ls|find)\b/i,
      // Recursive path discovery (glob tool)
      /^(?:find|fd|fdfind)(?:\.exe)?(?:\s|$)/i,
      /^rg(?:\.exe)?\b(?=[^\n]*\s--files\b)/i,
      /^(?:Get-Item|Resolve-Path)\b[^\n]*\*/i,
      /^(?:echo|printf)\s+[^\n]*\*/i,
      /^for\s+\w+\s+in\s+[^\n]*\*/i,
      /^for\s+\/r\b/i,
      /^for\s+%%?\w+\s+in\s+\(\*\)/i,
      /^where(?:\.exe)?\s+\/r\b/i,
      // git ls-files as list/glob substitute
      /^git(?:\.exe)?\s+(?:(?:-C\s+\S+|--no-pager|-c\s+\S+|--work-tree=\S+|--git-dir=\S+)\s+)*ls-files\b/i,
      // Shell redirection for file browsing
      /^(?:type|cat|more)(?:\.exe)?(?:\s|$)/i,
      /^(?:findstr)(?:\.exe)?(?:\s|$)/i,
    ],
  },
  // ── File destruction (rm -rf, format, dd, Remove-Item -Recurse -Force) ──
  {
    family: CommandFamily.FILE_DESTRUCTIVE,
    risk: "DESTRUCTIVE",
    hardBlock: false,
    permission: PermissionBucket.FILE,
    patterns: [
      /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive\s+--force)/i,
      /\brm\s+-rf\b/i,
      /\bformat\s+[a-z]:/i,
      /\bmkfs\b/i,
      /\bdd\s+if=/i,
      />\s*\/dev\/sd/i,
      /\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force/i,
      /\bRemove-Item\b[^\n]*-Force[^\n]*-Recurse/i,
    ],
  },
  // ── Database destruction ──
  {
    family: CommandFamily.DB_DESTRUCTIVE,
    risk: "DESTRUCTIVE",
    hardBlock: false,
    permission: PermissionBucket.DB,
    patterns: [
      /\bdrop\s+(table|database|schema|index|view)\b/i,
      /\btruncate\s+table\b/i,
      /\bdelete\s+from\b/i,
    ],
  },
  // ── Git working-tree rewrite — HARD BLOCK ──
  {
    family: CommandFamily.GIT_HISTORY_REWRITE,
    risk: "DESTRUCTIVE",
    hardBlock: true,
    permission: PermissionBucket.GIT,
    patterns: [
      /\bgit\s+checkout\b/i,
      /\bgit\s+switch\b/i,
      /\bgit\s+restore\b/i,
      /\bgit\s+reset\s+--hard\b/i,
      /\bgit\s+stash\s+pop\b/i,
      /\bgit\s+stash\s+apply\b/i,
      /\bgit\s+stash\s+drop\b/i,
      /\bgit\s+stash\s+clear\b/i,
      /\bgit\s+stash\s+branch\b/i,
    ],
  },
  // ── Git askable destructive (force-push, clean -f) ──
  {
    family: CommandFamily.GIT_ASKABLE_DESTRUCTIVE,
    risk: "DESTRUCTIVE",
    hardBlock: false,
    permission: PermissionBucket.GIT,
    patterns: [
      /\bgit\s+push\b[^\n]*--force\b/i,
      /\bgit\s+push\b[^\n]*-f\b/i,
      /\bgit\s+clean\s+-[a-zA-Z]*f/i,
    ],
  },
  // ── Fossil CLI mutate — HARD BLOCK (snapshot is runtime-only) ──
  {
    family: CommandFamily.FOSSIL_MUTATE,
    risk: "DESTRUCTIVE",
    hardBlock: true,
    permission: PermissionBucket.FOSSIL,
    patterns: [
      /\bfossil(?:\.exe)?\s+commit\b/i,
      /\bfossil(?:\.exe)?\s+ci\b/i,
      /\bfossil(?:\.exe)?\s+add\b/i,
      /\bfossil(?:\.exe)?\s+rm\b/i,
      /\bfossil(?:\.exe)?\s+delete\b/i,
      /\bfossil(?:\.exe)?\s+addremove\b/i,
      /\bfossil(?:\.exe)?\s+checkout\b/i,
      /\bfossil(?:\.exe)?\s+co\b/i,
      /\bfossil(?:\.exe)?\s+update\b/i,
      /\bfossil(?:\.exe)?\s+up\b/i,
      /\bfossil(?:\.exe)?\s+merge\b/i,
      /\bfossil(?:\.exe)?\s+undo\b/i,
      /\bfossil(?:\.exe)?\s+revert\b/i,
      /\bfossil(?:\.exe)?\s+close\b/i,
      /\bfossil(?:\.exe)?\s+open\b/i,
      /\bfossil(?:\.exe)?\s+push\b/i,
      /\bfossil(?:\.exe)?\s+pull\b/i,
      /\bfossil(?:\.exe)?\s+sync\b/i,
      /\bfossil(?:\.exe)?\s+clean\b/i,
    ],
  },
  // ── Elevated-risk operations (log, don't block) ──
  {
    family: CommandFamily.ELEVATED_GENERAL,
    risk: "ELEVATED",
    hardBlock: false,
    patterns: [
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
    ],
  },
]

// ============================================================================
// CLASSIFICATION — single entry point
// ============================================================================

export type ClassificationResult = {
  family: CommandFamily
  risk: Risk
  hardBlock: boolean
  permission?: PermissionBucket
}

/** Classify a raw command string → family + risk + block policy (unified). */
export function classifyCommand(command: string): ClassificationResult {
  const text = command.trim()
  if (!text) return { family: CommandFamily.ALLOWED, risk: "LOW", hardBlock: false }

  for (const entry of COMMAND_TABLE) {
    if (entry.patterns.some((re) => re.test(text))) {
      return {
        family: entry.family,
        risk: entry.risk,
        hardBlock: entry.hardBlock,
        permission: entry.permission,
      }
    }
  }
  return { family: CommandFamily.ALLOWED, risk: "LOW", hardBlock: false }
}

// ============================================================================
// SHELL SEGMENTATION — unwrap wrappers + split pipelines
// ============================================================================

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

// ============================================================================
// GUARDS — shell browsing + destructive + VCS
// ============================================================================

/** True when any pipeline segment is a file enumerator. */
export function isShellDirectoryBrowsing(command: string) {
  return shellSegments(command).some((seg) => {
    const c = classifyCommand(seg)
    return c.family === CommandFamily.FILE_ENUMERATOR
  })
}

export function isGitHistoryRewrite(command: string): boolean {
  return classifyCommand(command).family === CommandFamily.GIT_HISTORY_REWRITE
}

export function isFossilAgentMutate(command: string): boolean {
  return classifyCommand(command).family === CommandFamily.FOSSIL_MUTATE
}

export function isFileDestructive(command: string): boolean {
  return classifyCommand(command).family === CommandFamily.FILE_DESTRUCTIVE
}

export function isDbDestructive(command: string): boolean {
  return classifyCommand(command).family === CommandFamily.DB_DESTRUCTIVE
}

export function isGitAskableDestructive(command: string): boolean {
  return classifyCommand(command).family === CommandFamily.GIT_ASKABLE_DESTRUCTIVE
}

/** Opt-out: OPENCODE_ALLOW_DESTRUCTIVE=1|true|yes permits DESTRUCTIVE shell. */
export function allowDestructiveCommands(): boolean {
  const v = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
  if (v && (v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes")) return true
  const b = process.env["OPENCODE_BYPASS_CONSTITUTION"]
  if (b && (b === "1" || b.toLowerCase() === "true" || b.toLowerCase() === "yes")) return true
  return false
}

/** Map family → permission bucket. */
export function familyPermission(family: CommandFamily): PermissionBucket | undefined {
  for (const entry of COMMAND_TABLE) {
    if (entry.family === family) return entry.permission
  }
  return undefined
}

/**
 * Constitution preflight for shell.
 * - FILE_ENUMERATOR (ls/dir/find/fd/rg --files/…): HARD BLOCK → use list/glob/grep
 * - GIT_HISTORY_REWRITE / FOSSIL_MUTATE: HARD BLOCK unless env bypass
 * - FILE_DESTRUCTIVE / DB_DESTRUCTIVE / GIT_ASKABLE_DESTRUCTIVE: permission required
 * - ELEVATED_GENERAL: log only
 */
export type CommandGuardResult = {
  risk: Risk
  family: CommandFamily
  permission?: PermissionBucket
  needsDestructivePermission: boolean
  blocked: boolean
  message?: string
}

export function guardCommand(
  command: string,
  meta?: { sessionID?: string; agent?: string },
): CommandGuardResult {
  // Check file enumeration first (any segment)
  if (isShellDirectoryBrowsing(command)) {
    log.warn("constitution.directory_browsing_blocked", {
      command: command.slice(0, 200),
      sessionID: meta?.sessionID,
      agent: meta?.agent,
    })
    return {
      risk: "LOW",
      family: CommandFamily.FILE_ENUMERATOR,
      needsDestructivePermission: false,
      blocked: true,
      message:
        "constitution: BLOCKED shell directory/file enumeration (ls/dir/find/fd/rg --files/…). " +
        "Use the list tool for browsing; glob for path patterns; grep for content. " +
        "VCS checks (e.g. git ls-files --error-unmatch <path>) and PATH lookup (where/which) stay allowed.",
    }
  }

  const classification = classifyCommand(command)
  const allow = allowDestructiveCommands()

  if (classification.risk === "LOW" || classification.family === CommandFamily.ALLOWED) {
    return { risk: classification.risk, family: classification.family, needsDestructivePermission: false, blocked: false }
  }

  log.warn("constitution.command_risk", {
    risk: classification.risk,
    family: classification.family,
    command: command.slice(0, 200),
    sessionID: meta?.sessionID,
    agent: meta?.agent,
    allowDestructive: allow,
  })

  // ELEVATED — log, don't block
  if (classification.risk === "ELEVATED") {
    return { risk: classification.risk, family: classification.family, needsDestructivePermission: false, blocked: false }
  }

  // Hard block: git rewrite
  if (classification.family === CommandFamily.GIT_HISTORY_REWRITE && !allow) {
    return {
      risk: "DESTRUCTIVE",
      family: classification.family,
      permission: PermissionBucket.GIT,
      needsDestructivePermission: false,
      blocked: true,
      message:
        "constitution: BLOCKED git checkout/switch/restore/reset --hard/stash pop|apply|drop|clear " +
        "(permission: destructive-git). " +
        "Do NOT use git to undo or re-layer WIP — that can wipe uncommitted work. " +
        "Recover with: edit-tool .bak or Fossil snapshot restore. " +
        "Only set OPENCODE_ALLOW_DESTRUCTIVE=1 / bypass_constitution if you truly intend VCS rewrite.",
    }
  }

  // Hard block: fossil mutate
  if (classification.family === CommandFamily.FOSSIL_MUTATE && !allow) {
    return {
      risk: "DESTRUCTIVE",
      family: classification.family,
      permission: PermissionBucket.FOSSIL,
      needsDestructivePermission: false,
      blocked: true,
      message:
        "constitution: BLOCKED fossil CLI mutate (permission: destructive-fossil). " +
        "Fossil is automatic session undo/snapshot — not project VCS. " +
        "Use git for project history. Override only OPENCODE_ALLOW_DESTRUCTIVE=1 / bypass_constitution.",
    }
  }

  // Permission-required destructive
  if (classification.risk === "DESTRUCTIVE" && !allow) {
    const perm = classification.permission ?? PermissionBucket.FILE
    return {
      risk: classification.risk,
      family: classification.family,
      permission: perm,
      needsDestructivePermission: true,
      blocked: false,
      message:
        `constitution: DESTRUCTIVE (${perm}) requires explicit approval ` +
        `(rm -rf → destructive-file; DROP TABLE → destructive-db; force-push → destructive-git). ` +
        "Or set OPENCODE_ALLOW_DESTRUCTIVE=1 / bypass_constitution.",
    }
  }

  return { risk: classification.risk, family: classification.family, needsDestructivePermission: false, blocked: false }
}

// ============================================================================
// MUTATION TOOLS + GROUNDING GATE
// ============================================================================

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

// ============================================================================
// CLAIM LEDGER — system-owned grounding
// ============================================================================

export type ClaimRecord = {
  id: string
  text: string
  status: InfoMark
  reason?: string
  evidence?: string
  falsifier?: string
  stamped: boolean
}

export type ClaimLedger = {
  claims: Map<string, ClaimRecord>
  premises: string[]
  openQuestions: string[]
  active: boolean
  updatedAt: number
}

type SessionEpistemic = {
  ledger: ClaimLedger
  stamps: Map<string, { source: string; at: number }>
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

export function raiseEvidenceFloor(sessionID: string, mark: InfoMark) {
  const s = epistemic(sessionID)
  if (infoMarkAtLeast(mark, s.evidenceFloor)) s.evidenceFloor = mark
}

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

export function ingestAssistantText(sessionID: string, text: string): {
  ledgerUpdated: boolean
  stampsApplied: string[]
  demoted: string[]
} {
  const stampsApplied: string[] = []
  const demoted: string[] = []
  if (!text || text.length < 8) return { ledgerUpdated: false, stampsApplied, demoted }

  for (const m of text.matchAll(
    /oracle_stamp\s*:\s*[\s\S]*?claim_id\s*:\s*["']?([A-Za-z0-9_.-]+)["']?[\s\S]*?result\s*:\s*["']?PASS["']?/gi,
  )) {
    const id = m[1]
    stampClaim(sessionID, id, "oracle_stamp:PASS", "Exact")
    stampsApplied.push(id)
  }
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
    if (isGroundingMark(status) && !stamped) {
      demoted.push(raw.id)
      status = "Hypothetical"
      stamped = false
      log.debug("constitution.self_exact_rejected", { sessionID, claimID: raw.id })
    }
    if (stamped && s.stamps.has(raw.id)) {
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
  const fence = text.match(/```(?:yaml|yml)?\s*\n([\s\S]*?claim_ledger\s*:[\s\S]*?)```/i)
  if (fence?.[1]) return fence[1]
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

// ============================================================================
// UTILITY HELPERS
// ============================================================================

export function infoMarkAtLeast(left: InfoMark, right: InfoMark): boolean {
  return INFO_MARK_ORDER.indexOf(left) <= INFO_MARK_ORDER.indexOf(right)
}

export function isGroundingMark(mark: InfoMark): boolean {
  return mark === "Exact" || mark === "Inferred"
}

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

export function sessionReadExactBanner(sessionID: string): string {
  return (
    `## Session: ${sessionID}\n` +
    `info_mark: Exact — ground-truth archive (not a summary).\n` +
    `Prefer these IDs over Inferred compaction text when resolving conflicts.\n`
  )
}

export function evidenceUpgradeForTool(toolName: string): InfoMark | undefined {
  const t = toolName.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (t === "sessionread") return "Exact"
  if (t === "read" || t === "codegraph" || t === "codegraphexplore") return "Exact"
  if (t === "messagesearch" || t === "grep" || t === "glob" || t === "list") return "Inferred"
  return undefined
}

export function epistemicNudge(input: {
  tool: string
  evidenceFloor: InfoMark
  command?: string
  sessionID?: string
}): string | undefined {
  const effective = input.sessionID ? decisionFloor(input.sessionID) : input.evidenceFloor
  const floor =
    infoMarkAtLeast(effective, input.evidenceFloor) ? effective : input.evidenceFloor

  if (floor === "Exact") return undefined

  const isMutation = isMutationTool(input.tool)
  const isDestructiveCmd = input.command
    ? classifyCommand(input.command).risk === "DESTRUCTIVE"
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

// ============================================================================
// DEPRECATED — prefer guardCommand
// ============================================================================

/** @deprecated prefer guardCommand */
export function classifyCommandRisk(command: string): Risk {
  return classifyCommand(command).risk
}

/** @deprecated prefer guardCommand */
export function classifyDestructiveKind(command: string): "file" | "db" | "git" | "fossil" | null {
  const c = classifyCommand(command)
  if (c.family === CommandFamily.FILE_DESTRUCTIVE) return "file"
  if (c.family === CommandFamily.DB_DESTRUCTIVE) return "db"
  if (c.family === CommandFamily.GIT_HISTORY_REWRITE || c.family === CommandFamily.GIT_ASKABLE_DESTRUCTIVE) return "git"
  if (c.family === CommandFamily.FOSSIL_MUTATE) return "fossil"
  return null
}

/** @deprecated prefer guardCommand */
export function destructivePermission(kind: "file" | "db" | "git" | "fossil"): string {
  const map: Record<string, string> = {
    file: PermissionBucket.FILE,
    db: PermissionBucket.DB,
    git: PermissionBucket.GIT,
    fossil: PermissionBucket.FOSSIL,
  }
  return map[kind] ?? PermissionBucket.FILE
}

/** @deprecated prefer guardCommand */
export function noteCommandRisk(command: string, meta?: { sessionID?: string; agent?: string }): Risk {
  return guardCommand(command, meta).risk
}

export * as Constitution from "./constitution"
