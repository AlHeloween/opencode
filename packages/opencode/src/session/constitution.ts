/**
 * Runtime constitution — aligned with prompts_kernel v6.1.
 *
 * Single source of truth for: risk tiers, command classification,
 * shell browsing guard, destructive guard, mutation grounding.
 *
 * v6.2: TreeSitter-based command classification replaces regex.
 *   Constitution is a full TreeSitter client — parses shell commands
 *   with bash/batch/PowerShell grammars and classifies based on AST
 *   structure, not raw text regex.  Eliminates false positives from
 *   commit messages, quoted strings, and file paths.
 *
 * [KV-CACHE SAFE] — pure functions; never mutate system prompts.
 */
import * as Log from "@opencode-ai/core/util/log"
import { spawnSync } from "child_process"
import type { Node, Parser } from "web-tree-sitter"
import { getParser, commands as tsCommands, parts as tsParts, source as tsSource } from "@/shell/tree-sitter"

const log = Log.create({ service: "session.constitution" })

// ============================================================================
// PATH-AWARE ENUMERATION BINARY DETECTION
// ============================================================================

/**
 * First-token set of known enumeration binaries on THIS platform.
 * Only commands starting with these tokens are scanned for FILE_ENUMERATOR
 * patterns. Shell builtins are gated by platform; external binaries are
 * probed once via where/which at module load.
 *
 * Rationale: blocking `dir` on Linux or `ls` on native Windows is a false
 * positive — the command wouldn't work anyway, and the scary "BLOCKED"
 * message confuses agents into thinking they did something wrong.
 */
const _KNOWN_ENUM_FIRST_TOKENS = new Set<string>()

// Shell builtins / cmdlets — always present on their native platform
if (process.platform === "win32") {
  for (const t of ["dir", "type", "tree", "Get-ChildItem", "gci", "Get-Item", "Resolve-Path"]) {
    _KNOWN_ENUM_FIRST_TOKENS.add(t.toLowerCase())
  }
} else {
  for (const t of ["ls", "cat", "tree"]) {
    _KNOWN_ENUM_FIRST_TOKENS.add(t)
  }
}

// Cross-platform / POSIX — probe lazily: only block if binary exists on PATH
function _probeBinary(name: string): boolean {
  try {
    const cmd = process.platform === "win32" ? "where" : "which"
    const r = spawnSync(cmd, [name], { stdio: "ignore", timeout: 2000 })
    return r.status === 0
  } catch {
    return false
  }
}

for (const t of ["find", "fd", "fdfind", "rg", "more", "busybox"]) {
  if (_probeBinary(t)) _KNOWN_ENUM_FIRST_TOKENS.add(t)
}

// Always-scanned: for-globs + wrappers. echo/printf are NOT enumerators (allowed).
// git/where stay for allow-list early exits in evaluate/guardCommand paths.
for (const t of ["for", "git", "where", "busybox"]) {
  _KNOWN_ENUM_FIRST_TOKENS.add(t)
}

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
// AST-BASED COMMAND CLASSIFICATION TABLE
// ============================================================================

type CommandRule = {
  family: CommandFamily
  risk: Risk
  hardBlock: boolean
  permission?: PermissionBucket
  /** Command name (lowercased). */
  cmd: string
  /** Subcommand or first argument that triggers this rule. `null` = any. */
  sub: string | null
  /** Additional token predicates. `null` = no extra check. */
  extra?: (tokens: string[]) => boolean
}

/**
 * Structural classification rules — one entry per (cmd, sub) pair.
 *
 * Unlike regex patterns which scan the entire raw command string
 * (including commit messages, quoted strings, file paths), these
 * rules match against TreeSitter-extracted command tokens ONLY.
 *
 * Order matters: first match wins (same as regex table).
 */
const COMMAND_RULES: CommandRule[] = [
  // ── FS enumerators — HARD BLOCK ──
  ...([
    ["ls", null],
    ["dir", null],
    ["tree", null],
    ["find", null],
    ["fd", null],
    ["fdfind", null],
    ["get-childitem", null],
    ["gci", null],
    ["get-item", null],
    ["resolve-path", null],
    ["type", null],
    ["cat", null],
    ["more", null],
    ["busybox", null],
    ["for", null],
    // findstr / echo / printf are NOT hard-blocked:
    // - findstr = Windows content search (grep-like; product grep preferred, not exclusive)
    // - echo/printf = stdout print, not directory enumeration (even with *)
  ] as Array<[string, string | null]>).map(([cmd, sub]) => ({
    family: CommandFamily.FILE_ENUMERATOR,
    risk: "LOW" as Risk,
    hardBlock: true,
    cmd,
    sub,
    // `for` with * is still used as a poor-man's tree walk — keep that gate
    extra: cmd === "for"
      ? ((tokens: string[]) => tokens.some((t) => t.includes("*")))
      : (cmd === "rg" || cmd === "rg.exe")
        ? ((tokens: string[]) => tokens.includes("--files"))
        : undefined,
  })),

  // ── File destruction ──
  {
    family: CommandFamily.FILE_DESTRUCTIVE, risk: "DESTRUCTIVE", hardBlock: false,
    permission: PermissionBucket.FILE,
    cmd: "rm", sub: null,
    extra: (tokens) => tokens.some((t) => /^-(-?)[a-zA-Z]*r[a-zA-Z]*f|^-(-?)[a-zA-Z]*f[a-zA-Z]*r/.test(t)),
  },
  {
    family: CommandFamily.FILE_DESTRUCTIVE, risk: "DESTRUCTIVE", hardBlock: false,
    permission: PermissionBucket.FILE,
    cmd: "remove-item", sub: null,
    extra: (tokens) => tokens.includes("-recurse") && tokens.includes("-force"),
  },
  {
    family: CommandFamily.FILE_DESTRUCTIVE, risk: "DESTRUCTIVE", hardBlock: false,
    permission: PermissionBucket.FILE,
    cmd: "format", sub: null,
  },
  {
    family: CommandFamily.FILE_DESTRUCTIVE, risk: "DESTRUCTIVE", hardBlock: false,
    permission: PermissionBucket.FILE,
    cmd: "mkfs", sub: null,
  },
  {
    family: CommandFamily.FILE_DESTRUCTIVE, risk: "DESTRUCTIVE", hardBlock: false,
    permission: PermissionBucket.FILE,
    cmd: "dd", sub: null,
  },

  // ── Database destruction ──
  {
    family: CommandFamily.DB_DESTRUCTIVE, risk: "DESTRUCTIVE", hardBlock: false,
    permission: PermissionBucket.DB,
    cmd: "drop", sub: null,
  },
  {
    family: CommandFamily.DB_DESTRUCTIVE, risk: "DESTRUCTIVE", hardBlock: false,
    permission: PermissionBucket.DB,
    cmd: "truncate", sub: null,
  },
  {
    family: CommandFamily.DB_DESTRUCTIVE, risk: "DESTRUCTIVE", hardBlock: false,
    permission: PermissionBucket.DB,
    cmd: "delete", sub: null,
  },

  // ── Git working-tree rewrite — HARD BLOCK ──
  ...(["checkout", "switch", "restore"] as string[]).map((sub) => ({
    family: CommandFamily.GIT_HISTORY_REWRITE, risk: "DESTRUCTIVE" as Risk, hardBlock: true,
    permission: PermissionBucket.GIT,
    cmd: "git", sub,
  })),
  {
    family: CommandFamily.GIT_HISTORY_REWRITE, risk: "DESTRUCTIVE", hardBlock: true,
    permission: PermissionBucket.GIT,
    cmd: "git", sub: "reset",
    extra: (tokens) => tokens.includes("--hard"),
  },
  ...(["pop", "apply", "drop", "clear", "branch"] as string[]).map((stashSub) => ({
    family: CommandFamily.GIT_HISTORY_REWRITE, risk: "DESTRUCTIVE" as Risk, hardBlock: true,
    permission: PermissionBucket.GIT,
    cmd: "git", sub: "stash",
    extra: (tokens: string[]) => tokens[2] === stashSub,
  })),

  // ── Git askable destructive ──
  {
    family: CommandFamily.GIT_ASKABLE_DESTRUCTIVE, risk: "DESTRUCTIVE", hardBlock: false,
    permission: PermissionBucket.GIT,
    cmd: "git", sub: "push",
    extra: (tokens) => tokens.includes("--force") || tokens.includes("-f"),
  },
  {
    family: CommandFamily.GIT_ASKABLE_DESTRUCTIVE, risk: "DESTRUCTIVE", hardBlock: false,
    permission: PermissionBucket.GIT,
    cmd: "git", sub: "clean",
    extra: (tokens) => tokens.some((t) => /^-[a-zA-Z]*f/.test(t)),
  },

  // ── Fossil CLI mutate — HARD BLOCK ──
  ...(["commit", "ci", "add", "rm", "delete", "addremove", "checkout", "co",
      "update", "up", "merge", "undo", "revert", "close", "open",
      "push", "pull", "sync", "clean"] as string[]).map((sub) => ({
    family: CommandFamily.FOSSIL_MUTATE, risk: "DESTRUCTIVE" as Risk, hardBlock: true,
    permission: PermissionBucket.FOSSIL,
    cmd: "fossil", sub,
  })),

  // ── Elevated-risk operations ──
  {
    family: CommandFamily.ELEVATED_GENERAL, risk: "ELEVATED", hardBlock: false,
    cmd: "git", sub: "push",
  },
  {
    family: CommandFamily.ELEVATED_GENERAL, risk: "ELEVATED", hardBlock: false,
    cmd: "git", sub: "commit",
  },
  {
    family: CommandFamily.ELEVATED_GENERAL, risk: "ELEVATED", hardBlock: false,
    cmd: "npm", sub: "publish",
  },
  {
    family: CommandFamily.ELEVATED_GENERAL, risk: "ELEVATED", hardBlock: false,
    cmd: "bun", sub: "publish",
  },
  {
    family: CommandFamily.ELEVATED_GENERAL, risk: "ELEVATED", hardBlock: false,
    cmd: "docker", sub: null,
  },
  {
    family: CommandFamily.ELEVATED_GENERAL, risk: "ELEVATED", hardBlock: false,
    cmd: "chmod", sub: null,
  },
  {
    family: CommandFamily.ELEVATED_GENERAL, risk: "ELEVATED", hardBlock: false,
    cmd: "chown", sub: null,
  },
  {
    family: CommandFamily.ELEVATED_GENERAL, risk: "ELEVATED", hardBlock: false,
    cmd: "kubectl", sub: "delete",
  },
  {
    family: CommandFamily.ELEVATED_GENERAL, risk: "ELEVATED", hardBlock: false,
    cmd: "helm", sub: "delete",
  },
  {
    family: CommandFamily.ELEVATED_GENERAL, risk: "ELEVATED", hardBlock: false,
    cmd: "remove-item", sub: null,
  },
  {
    family: CommandFamily.ELEVATED_GENERAL, risk: "ELEVATED", hardBlock: false,
    cmd: "del", sub: null,
  },
  {
    family: CommandFamily.ELEVATED_GENERAL, risk: "ELEVATED", hardBlock: false,
    cmd: "rmdir", sub: null,
  },
]

// ============================================================================
// CLASSIFICATION — unified AST-based entry points
// ============================================================================

export type ClassificationResult = {
  family: CommandFamily
  risk: Risk
  hardBlock: boolean
  permission?: PermissionBucket
}

/**
 * Classify a single command node using AST-extracted tokens.
 *
 * Only the actual command tokens are checked — not quoted strings,
 * commit messages, file paths, or other non-command text.
 */
export function classifyAstNode(cmd: string, sub: string | undefined, tokens: string[]): ClassificationResult {
  if (!cmd) return { family: CommandFamily.ALLOWED, risk: "LOW", hardBlock: false }

  // PATH-aware gate: only check FILE_ENUMERATOR rules when the binary exists
  const scanEnumeration = _KNOWN_ENUM_FIRST_TOKENS.has(cmd)

  for (const rule of COMMAND_RULES) {
    if (rule.family === CommandFamily.FILE_ENUMERATOR && !scanEnumeration) continue
    if (rule.cmd !== cmd) continue
    if (rule.sub !== null && rule.sub !== sub) continue
    if (rule.extra && !rule.extra(tokens)) continue

    return {
      family: rule.family,
      risk: rule.risk,
      hardBlock: rule.hardBlock,
      permission: rule.permission,
    }
  }

  return { family: CommandFamily.ALLOWED, risk: "LOW", hardBlock: false }
}

// ============================================================================
// CONSTITUTION EVALUATION — main entry point for shell tools
// ============================================================================

/** Per-command finding from constitution evaluation. */
export type CommandFinding = {
  /** The command source text (for display). */
  command: string
  /** Classification result. */
  classification: ClassificationResult
  /** Whether this command is a file enumerator. */
  isFileEnumerator: boolean
}

/** Result of a full constitution evaluation over a parsed shell command. */
export type ConstitutionEvalResult = {
  /** All command nodes found in the AST, with their classifications. */
  findings: CommandFinding[]
  /** Hard-blocked commands (FILE_ENUMERATOR, GIT_HISTORY_REWRITE, FOSSIL_MUTATE). */
  blocked: CommandFinding[]
  /** Commands that require destructive permission before execution. */
  needsPermission: CommandFinding[]
  /** Whether any finding is elevated risk (log, don't block). */
  hasElevated: boolean
}

/**
 * Evaluate a parsed shell command AST against the constitution.
 *
 * Walks every command node in the tree, classifies each, and returns
 * structured findings.  The caller (bash.ts / cmd.ts) handles the
 * results: throw on hard-blocks, ask for destructive permissions,
 * log elevated operations.
 *
 * @param root - Parsed TreeSitter root node
 * @param isCmd - True for cmd.exe batch grammar, false for bash/PowerShell
 */
export function evaluate(root: Node, isCmd: boolean): ConstitutionEvalResult {
  const findings: CommandFinding[] = []
  const blocked: CommandFinding[] = []
  const needsPermission: CommandFinding[] = []
  let hasElevated = false

  for (const node of tsCommands(root, isCmd)) {
    const commandParts = tsParts(node, isCmd)
    const tokens = commandParts.map((p) => p.text)
    const lower = tokens.map((t) => t.toLowerCase())
    const cmd = lower[0] ?? ""
    const sub = lower[1]

    // git ls-files is always allowed — VCS oracle, not FS enumeration
    if (cmd === "git" && sub === "ls-files") continue
    // where/which — PATH lookup, not enumeration
    if (cmd === "where" || cmd === "where.exe" || cmd === "which") continue
    // rg without --files is content search, not enumeration
    if ((cmd === "rg" || cmd === "rg.exe") && !lower.includes("--files")) continue

    const classification = classifyAstNode(cmd, sub, lower)
    const sourceText = tsSource(node, isCmd)

    const finding: CommandFinding = {
      command: sourceText,
      classification,
      isFileEnumerator: classification.family === CommandFamily.FILE_ENUMERATOR,
    }
    findings.push(finding)

    if (finding.isFileEnumerator || classification.hardBlock) {
      blocked.push(finding)
    }
    if (classification.risk === "DESTRUCTIVE" && !classification.hardBlock) {
      needsPermission.push(finding)
    }
    if (classification.risk === "ELEVATED") {
      hasElevated = true
    }
  }

  return { findings, blocked, needsPermission, hasElevated }
}

/**
 * Convenience: parse + evaluate in one call (for tools that don't already parse).
 *
 * Uses the appropriate TreeSitter grammar based on shellType:
 *   "bash" → bash grammar, "cmd" → batch grammar, "ps" → PowerShell grammar
 */
export async function evaluateCommand(
  command: string,
  shellType: "bash" | "cmd" | "ps",
): Promise<ConstitutionEvalResult> {
  const parser = await getParser()
  const engine: Parser = shellType === "cmd" ? parser.cmd : shellType === "ps" ? parser.ps : parser.bash
  const tree = engine.parse(command)
  if (!tree) throw new Error("Failed to parse command for constitution evaluation")
  return evaluate(tree.rootNode, shellType === "cmd")
}

// ============================================================================
// LEGACY: regex-based classifyCommand (kept for backward compat / run.ts)
// ============================================================================

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
// GUARDS — AST-based (primary, for bash/cmd) + regex-based (legacy, for run.ts)
// ============================================================================

// ── AST-based (preferred) ──

/** True when any command node in the parsed AST is a file enumerator. */
export function isShellDirectoryBrowsing(root: Node, isCmd: boolean): boolean {
  return evaluate(root, isCmd).blocked.some((f) => f.isFileEnumerator)
}

/** True when any command node triggers git history rewrite. */
export function isGitHistoryRewrite(root: Node, isCmd: boolean): boolean {
  return evaluate(root, isCmd).blocked.some(
    (f) => f.classification.family === CommandFamily.GIT_HISTORY_REWRITE,
  )
}

/** True when any command node triggers fossil mutate. */
export function isFossilAgentMutate(root: Node, isCmd: boolean): boolean {
  return evaluate(root, isCmd).blocked.some(
    (f) => f.classification.family === CommandFamily.FOSSIL_MUTATE,
  )
}

export function isFileDestructive(root: Node, isCmd: boolean): boolean {
  return evaluate(root, isCmd).needsPermission.some(
    (f) => f.classification.family === CommandFamily.FILE_DESTRUCTIVE,
  )
}

export function isDbDestructive(root: Node, isCmd: boolean): boolean {
  return evaluate(root, isCmd).needsPermission.some(
    (f) => f.classification.family === CommandFamily.DB_DESTRUCTIVE,
  )
}

export function isGitAskableDestructive(root: Node, isCmd: boolean): boolean {
  return evaluate(root, isCmd).needsPermission.some(
    (f) => f.classification.family === CommandFamily.GIT_ASKABLE_DESTRUCTIVE,
  )
}

// ── Regex-based (legacy, for run.ts and backward compat) ──

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
  for (const rule of COMMAND_RULES) {
    if (rule.family === family) return rule.permission
  }
  return undefined
}

/** Map CommandFamily → destructive kind string. */
function destructiveFamilyKind(family: CommandFamily): "file" | "db" | "git" | "fossil" | undefined {
  if (family === CommandFamily.FILE_DESTRUCTIVE) return "file"
  if (family === CommandFamily.DB_DESTRUCTIVE) return "db"
  if (family === CommandFamily.GIT_HISTORY_REWRITE || family === CommandFamily.GIT_ASKABLE_DESTRUCTIVE) return "git"
  if (family === CommandFamily.FOSSIL_MUTATE) return "fossil"
  return undefined
}

export type CommandGuardResult = {
  risk: Risk
  family: CommandFamily
  permission?: PermissionBucket
  needsDestructivePermission: boolean
  blocked: boolean
  message?: string
  kind?: "file" | "db" | "git" | "fossil"
}

/**
 * Regex-based guard — for run.ts and non-TreeSitter contexts.
 *
 * Uses shellSegments + regex classifyCommand on each segment.
 * Has known false-positive risk with commit messages containing
 * command-like words (e.g. "fossil clean" in git commit -m "...").
 * Prefer guardFromEval() / evaluate() when TreeSitter AST is available.
 */
export function guardCommand(
  command: string,
  meta?: { sessionID?: string; agent?: string },
): CommandGuardResult {
  // Check file enumeration first (any segment) — uses legacy shellSegments + regex
  const segments = shellSegments(command)
  for (const seg of segments) {
    const firstToken = seg.split(/\s+/)[0]?.replace(/^.*[/\\]/, "")?.toLowerCase().replace(/\.exe$/, "") ?? ""
    if (_KNOWN_ENUM_FIRST_TOKENS.has(firstToken)) {
      const c = classifyAstNode(firstToken, undefined, seg.split(/\s+/).map((s) => s.toLowerCase().replace(/\.exe$/, "")))
      if (c.family === CommandFamily.FILE_ENUMERATOR) {
        // git ls-files, where/which, rg without --files are allowed
        if (firstToken === "git" || firstToken === "where" || firstToken === "which") continue
        if ((firstToken === "rg" || firstToken === "rg.exe") && !seg.includes("--files")) continue

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
    }
  }

  // Classify using first-token extraction from raw string
  const text = command.trim()
  if (!text) return { risk: "LOW", family: CommandFamily.ALLOWED, needsDestructivePermission: false, blocked: false }

  const tokens = text.split(/\s+/)
  const rawCmd = tokens[0]?.replace(/^.*[/\\]/, "")?.toLowerCase() ?? ""
  // Strip .exe suffix for cross-platform matching (fossil.exe → fossil, git.exe → git)
  const cmd = rawCmd.replace(/\.exe$/, "")
  const sub = tokens[1]?.toLowerCase()
  const lower = tokens.map((t) => t.toLowerCase().replace(/\.exe$/, ""))
  const classification = classifyAstNode(cmd, sub, lower)
  const allow = allowDestructiveCommands()

  // FILE_ENUMERATOR is hard-blocked regardless of risk level (risk=LOW but blocked=true)
  if (classification.family === CommandFamily.FILE_ENUMERATOR) {
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

  if (classification.risk === "ELEVATED") {
    return { risk: classification.risk, family: classification.family, needsDestructivePermission: false, blocked: false }
  }

  if (classification.family === CommandFamily.GIT_HISTORY_REWRITE && !allow) {
    return {
      risk: "DESTRUCTIVE", family: classification.family, permission: PermissionBucket.GIT,
      needsDestructivePermission: false, blocked: true,
      message:
        "constitution: BLOCKED git checkout/switch/restore/reset --hard/stash pop|apply|drop|clear " +
        "(permission: destructive-git). " +
        "Do NOT use git to undo or re-layer WIP — that can wipe uncommitted work. " +
        "Recover with: edit-tool .bak or Fossil snapshot restore. " +
        "Only set OPENCODE_ALLOW_DESTRUCTIVE=1 / bypass_constitution if you truly intend VCS rewrite.",
    }
  }

  if (classification.family === CommandFamily.FOSSIL_MUTATE && !allow) {
    return {
      risk: "DESTRUCTIVE", family: classification.family, permission: PermissionBucket.FOSSIL,
      needsDestructivePermission: false, blocked: true,
      message:
        "constitution: BLOCKED fossil CLI mutate (permission: destructive-fossil). " +
        "Fossil is automatic session undo/snapshot — not project VCS. " +
        "Use git for project history. Override only OPENCODE_ALLOW_DESTRUCTIVE=1 / bypass_constitution.",
    }
  }

  if (classification.risk === "DESTRUCTIVE" && !allow) {
    const perm = classification.permission ?? PermissionBucket.FILE
    const kind = destructiveFamilyKind(classification.family)
    return {
      risk: classification.risk, family: classification.family, permission: perm, kind,
      needsDestructivePermission: true, blocked: false,
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
// DEPRECATED — prefer guardCommand / evaluate
// ============================================================================

/**
 * Regex-free token classifier — for backward compat.
 * Extracts first two tokens from raw string and classifies.
 * @deprecated Prefer {@link evaluate} with parsed AST.
 */
export function classifyCommand(command: string): ClassificationResult {
  const text = command.trim()
  if (!text) return { family: CommandFamily.ALLOWED, risk: "LOW", hardBlock: false }
  const tokens = text.split(/\s+/)
  const cmd = tokens[0]?.replace(/^.*[/\\]/, "")?.toLowerCase() ?? ""
  const sub = tokens[1]?.toLowerCase()
  const lower = tokens.map((t) => t.toLowerCase())
  return classifyAstNode(cmd, sub, lower)
}

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
