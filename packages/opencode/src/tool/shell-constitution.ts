/**
 * Shared constitution preflight for shell/binary tools.
 *
 * Two enforcement paths:
 *   enforceDestructiveShell        — legacy regex/token-based (used by run.ts)
 *   enforceDestructiveShellFromAst — AST-based via Constitution.evaluate() (bash.ts/cmd.ts)
 *
 * Constitution is the single authority — this module is a thin Effect wrapper.
 */
import { Effect } from "effect"
import { Constitution } from "@/session/constitution"
import type * as Tool from "./tool"
import type { Node } from "web-tree-sitter"

/**
 * `cmd_runner send <run_id> … -- <payload>`
 *
 * Payload is **stdin/keys into an existing run** — often an SSH session on a remote
 * host, not a local worktree browse. Structure scan must not hard-block remote
 * `ls`/`dir`/`find`. Brutal DESTRUCTIVE in the payload still permission-asks
 * (same as bare local shell).
 */
const CMD_RUNNER_SEND_PAYLOAD = /^(cmd_runner(?:\.exe)?\s+send\s+.*?--\s*)(.*)/s

export type CmdRunnerSendSplit = {
  /** Prefix including `… --` — TreeSitter + full constitution (local wrapper only). */
  shellScan: string
  /** Text after `--` (session input). Brutal DESTRUCTIVE permission only. */
  payload: string | undefined
}

/** Split cmd_runner send so SSH/session payload uses a different constitution policy. */
export function splitCmdRunnerSend(command: string): CmdRunnerSendSplit {
  const m = command.match(CMD_RUNNER_SEND_PAYLOAD)
  if (!m) return { shellScan: command, payload: undefined }
  const payload = (m[2] ?? "").trim()
  return { shellScan: m[1] ?? command, payload: payload.length ? payload : undefined }
}

/** Strip send payload for local structure/path scans (wrapper only). */
export function stripCmdRunnerSendPayload(command: string): string {
  return splitCmdRunnerSend(command).shellScan
}

/**
 * AST-based constitution enforcement — primary path for bash.ts / cmd.ts.
 *
 * Calls Constitution.evaluate() on the parsed TreeSitter root node,
 * then throws on hard-blocks and asks for destructive permissions.
 */
export function enforceDestructiveShellFromAst(
  root: Node,
  isCmd: boolean,
  ctx: Tool.Context,
  description?: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const result = Constitution.evaluate(root, isCmd)

    // Hard blocks (FILE_ENUMERATOR, GIT_HISTORY_REWRITE, FOSSIL_MUTATE)
    for (const finding of result.blocked) {
      const msg = finding.isFileEnumerator
        ? "constitution: BLOCKED shell directory/file enumeration (ls/dir/find/fd/rg --files/…). " +
          "Use the list tool for browsing; glob for path patterns; grep for content. " +
          "VCS checks (e.g. git ls-files --error-unmatch <path>) and PATH lookup (where/which) stay allowed."
        : finding.classification.family === "FOSSIL_MUTATE"
          ? "constitution: BLOCKED fossil CLI mutate (permission: destructive-fossil). " +
            "Fossil is automatic session undo/snapshot — not project VCS. " +
            "Use git for project history. Override only OPENCODE_ALLOW_DESTRUCTIVE=1 / bypass_constitution."
          : "constitution: BLOCKED git checkout/switch/restore/reset --hard/stash pop|apply|drop|clear " +
            "(permission: destructive-git). " +
            "Do NOT use git to undo or re-layer WIP — that can wipe uncommitted work. " +
            "Recover with: edit-tool .bak or Fossil snapshot restore. " +
            "Only set OPENCODE_ALLOW_DESTRUCTIVE=1 / bypass_constitution if you truly intend VCS rewrite."
      throw new Error(msg)
    }

    // Destructive permissions required (rm -rf, force-push, DROP TABLE, etc.)
    for (const finding of result.needsPermission) {
      const perm = finding.classification.permission ?? "destructive-file"
      const kind = finding.classification.family === "FILE_DESTRUCTIVE" ? "file"
        : finding.classification.family === "DB_DESTRUCTIVE" ? "db"
        : "git"
      yield* ctx.ask({
        permission: perm,
        patterns: [finding.command.slice(0, 160)],
        always: [finding.command.slice(0, 160)],
        metadata: {
          risk: "DESTRUCTIVE",
          kind,
          constitution: true,
          message: `constitution: DESTRUCTIVE (${perm}) requires explicit approval. ` +
            "Or set OPENCODE_ALLOW_DESTRUCTIVE=1 / bypass_constitution.",
          command: finding.command.slice(0, 400),
          description,
        },
      })
    }
  })
}

/**
 * Legacy regex/token-based enforcement — for run.ts and non-TreeSitter contexts.
 *
 * Calls Constitution.guardCommand() which uses first-token extraction.
 * Has known false-positive risk with commit messages containing command-like
 * words.  Prefer {@link enforceDestructiveShellFromAst} when AST is available.
 *
 * For `cmd_runner send … -- payload`: full guard on wrapper only; payload is
 * brutal-DESTRUCTIVE permission only (no ls/dir hard-blocks).
 */
export function enforceDestructiveShell(
  command: string,
  ctx: Tool.Context,
  description?: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const split = splitCmdRunnerSend(command)
    const guard = Constitution.guardCommand(split.shellScan, {
      sessionID: ctx.sessionID,
      agent: ctx.extra?.agent as string | undefined,
    })
    if (guard.blocked) {
      throw new Error(guard.message ?? "constitution: command blocked")
    }
    if (guard.needsDestructivePermission) {
      const permission = guard.permission ?? "destructive-file"
      const pattern = split.shellScan.slice(0, 160)
      yield* ctx.ask({
        permission,
        patterns: [pattern],
        always: [pattern],
        metadata: {
          risk: "DESTRUCTIVE",
          kind: guard.kind,
          constitution: true,
          message: guard.message,
          command: command.slice(0, 400),
          description,
        },
      })
    }
    if (split.payload) {
      yield* enforceBrutalDestructiveOnly(split.payload, ctx, description)
    }
  })
}

/**
 * Session input after `cmd_runner send … --` (local TUI or SSH remote).
 * No browsing hard-blocks; only brutal DESTRUCTIVE → permission ask (same as bare shell).
 */
export function enforceBrutalDestructiveOnly(
  payload: string,
  ctx: Tool.Context,
  description?: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const guard = Constitution.guardBrutalDestructive(payload, {
      sessionID: ctx.sessionID,
      agent: ctx.extra?.agent as string | undefined,
    })
    if (!guard.needsDestructivePermission) return
    const permission = guard.permission ?? "destructive-file"
    const pattern = payload.slice(0, 160)
    yield* ctx.ask({
      permission,
      patterns: [pattern],
      always: [pattern],
      metadata: {
        risk: "DESTRUCTIVE",
        kind: guard.kind,
        constitution: true,
        cmd_runner_send_payload: true,
        message: guard.message,
        command: payload.slice(0, 400),
        description,
      },
    })
  })
}

// ============================================================================
// Crash-prone binary enforcement (regex, no false-positive risk)
// ============================================================================

const CRASH_PRONE_BINARIES = [
  "clang\\+\\+", "clang", "rustc", "cargo", "zig", "dotnet", "msbuild",
  "ninja", "cmake", "make", "g\\+\\+", "gcc", "go", "bun",
] as const

const CRASH_PRONE_RE = new RegExp(
  `(?:^|[;&|]\\s*)\\b(?:${CRASH_PRONE_BINARIES.join("|")})(?:\\.exe)?\\b(?![^\\s]*--)`,
  "i",
)

const VIA_CMD_RUNNER = /\bcmd_runner(?:\.exe)?\b/i

export function enforceBinaryViaCmdRunner(command: string): void {
  if (CRASH_PRONE_RE.test(command) && !VIA_CMD_RUNNER.test(command)) {
    const match = command.match(CRASH_PRONE_RE)?.[0]?.trim() ?? "binary"
    throw new Error(
      `constitution: ${match} must run through cmd_runner for process isolation. ` +
      `Use: cmd_runner start -- ${match} <args...>`,
    )
  }
}
