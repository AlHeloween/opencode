/**
 * Shared constitution preflight for shell/binary tools.
 *
 * Two enforcement paths:
 *   enforceDestructiveShell        — legacy regex/token-based (used by run.ts)
 *   enforceDestructiveShellFromAst — AST-based via Constitution.evaluate() (bash.ts/cmd.ts)
 *
 * `run` stays on the legacy path on purpose: it is binary+argv, not a shell.
 * Prefer AST for bash/cmd only. Do not force AST on pure argv (false-positive risk low;
 * compound shell belongs in bash/cmd tools).
 *
 * Constitution is the single authority — this module is a thin Effect wrapper.
 */
import { Effect } from "effect"
import { Constitution } from "@/session/constitution"
import * as Log from "@opencode-ai/core/util/log"
import type * as Tool from "./tool"
import type { Node } from "web-tree-sitter"

/**
 * `cmd_runner send <run_id> … -- <payload>`
 *
 * Payload is **stdin/keys into an existing run**, e.g.:
 * - SSH / remote interactive shell
 * - Interactive TUI debugging (opencode, installers, ncurses)
 *
 * Not a local worktree “agent browse” command. Structure scan must not
 * hard-block session-side `ls`/`dir`/`find`. Brutal DESTRUCTIVE in the
 * payload still permission-asks (same as bare local shell).
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
 * Session input after `cmd_runner send … --` (SSH remote **or** interactive TUI debug).
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

/**
 * bun is crash-prone ONLY for `bun test` (TUI-crashing test runner).
 * `bun run` / `bun build` / `bun x` stay unwrapped (user directive 2026-09-09).
 * "bun test" | "bun ./test/..." → true; "bun run x" / bare "bun" → false.
 */
function isBunTestInvocation(command: string): boolean {
  return /(?:^|[;&|]\s*)\bbun(?:\.exe)?\s+(?:test\b|\.\/test\b|\S*\.test\.)/i.test(command)
}

/**
 * cmd_runner availability probe (cached). Constitution routing requires the
 * wrapper binary; without it routing degrades gracefully (skip, one warn).
 * Tests override the probe via setCmdRunnerProbe().
 */
let cmdRunnerProbe: boolean | undefined
export function setCmdRunnerProbe(value: boolean | undefined): void {
  cmdRunnerProbe = value
}
function cmdRunnerAvailable(): boolean {
  if (cmdRunnerProbe !== undefined) return cmdRunnerProbe
  try {
    const dirs = (process.env.PATH ?? "").split(/[;:]/).filter(Boolean)
    const exts = process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase())
      : [""]
    const names = process.platform === "win32"
      ? ["cmd_runner.exe", "cmd_runner", "cmd_runner.cmd"]
      : ["cmd_runner"]
    outer: for (const dir of dirs) {
      for (const name of names) {
        for (const ext of exts) {
          const candidate = `${dir}\\${name}${ext}`.replace(/\\\\/g, "\\")
          try {
            require("fs").accessSync(candidate)
            cmdRunnerProbe = true
            return true
          } catch {
            continue
          }
        }
      }
    }
    cmdRunnerProbe = false
  } catch {
    cmdRunnerProbe = false
  }
  if (!cmdRunnerProbe) {
    Log.Default.warn("cmd_runner not found in PATH — crash-prone binary routing disabled (graceful skip)")
  }
  return cmdRunnerProbe
}

/** True when the command hits a crash-prone binary and is not already inside cmd_runner. */
export function shouldRouteViaCmdRunner(command: string): boolean {
  if (VIA_CMD_RUNNER.test(command)) return false
  const match = command.match(CRASH_PRONE_RE)
  if (!match) return false
  // bun: only test invocations are routed; run/build/x stay bare.
  if (/\bbun(?:\.exe)?\b/i.test(match[0])) {
    if (!isBunTestInvocation(command)) return false
  }
  // Graceful degradation: no wrapper binary → no routing (constitutional
  // block would make the tool unusable on installs without cmd_runner).
  if (!cmdRunnerAvailable()) return false
  return true
}

/**
 * Auto-route crash-prone binaries through cmd_runner (2026-09-07, user request):
 * instead of throwing "must run through cmd_runner", wrap the command into
 * `cmd_runner start -- <command>` so process isolation is applied automatically.
 * Send payloads (`cmd_runner send … --`) and already-wrapped commands pass through.
 */
export function autoWrapCmdRunner(command: string): { command: string; wrapped: boolean } {
  if (!shouldRouteViaCmdRunner(command)) return { command, wrapped: false }
  return { command: `cmd_runner start -- ${command}`, wrapped: true }
}

/** Binary+argv form of {@link autoWrapCmdRunner} for the run tool. */
export function autoWrapBinary(
  binary: string,
  args: string[],
): { binary: string; args: string[]; wrapped: boolean } {
  if (!shouldRouteViaCmdRunner([binary, ...args].join(" "))) return { binary, args, wrapped: false }
  return { binary: "cmd_runner", args: ["start", "--", binary, ...args], wrapped: true }
}

/**
 * Defense-in-depth safety net: normally the caller auto-wraps via
 * {@link autoWrapCmdRunner} BEFORE execution and this becomes a no-op
 * (wrapped commands contain `cmd_runner`). Still throws when a crash-prone
 * binary would run bare — e.g. when a caller skips the wrap step.
 */
export function enforceBinaryViaCmdRunner(command: string): void {
  if (!shouldRouteViaCmdRunner(command)) return
  const match = command.match(CRASH_PRONE_RE)?.[0]?.trim() ?? "binary"
  throw new Error(
    `constitution: ${match} must run through cmd_runner for process isolation. ` +
    `Use: cmd_runner start -- ${match} <args...>`,
  )
}
