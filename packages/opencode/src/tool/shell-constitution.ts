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
import path from "node:path"
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
 * cmd_runner availability probe (cached). Constitution routing requires the
 * wrapper binary; without it routing degrades gracefully (skip, one warn).
 * Tests override the probe via setCmdRunnerProbe().
 */
let cmdRunnerProbe: boolean | undefined
/** Which rung established availability — recorded, like the provider transport rungs. */
let cmdRunnerRung: string | undefined
export function setCmdRunnerProbe(value: boolean | undefined): void {
  cmdRunnerProbe = value
  cmdRunnerRung = value === undefined ? undefined : "test-override"
}
export function cmdRunnerRungName(): string | undefined {
  return cmdRunnerRung
}
/**
 * Where to look for the wrapper. PATH alone is NOT enough: this repo keeps
 * `cmd_runner.exe` at the repo ROOT while PATH carries `<repo>\bin`, so the
 * PATH-only probe returned false, the guard disabled itself, and EVERY
 * crash-prone binary (cargo, msbuild, zig, bun) ran bare with one WARN as the
 * only trace (2026-09-18). Widen, then fail CLOSED below.
 */
function probeDirs(): string[] {
  const strip = (d: string) => d.trim().replace(/^"|"$/g, "")
  const fromPath = (process.env.PATH ?? "").split(/[;:]/).filter(Boolean).map(strip)
  const exeDir = path.dirname(process.execPath)
  const extra = [exeDir, path.dirname(exeDir), path.join(exeDir, "bin"), process.cwd()]
  return [...new Set([...fromPath, ...extra].filter(Boolean))]
}

function cmdRunnerAvailable(): boolean {
  if (cmdRunnerProbe !== undefined) return cmdRunnerProbe
  // Cheap, idiomatic lookup — the `which cmd_runner` equivalent. The PATH scan
  // below is only a fallback for a wrapper that is NOT on PATH.
  const viaWhich = Bun.which("cmd_runner")
  if (viaWhich) {
    cmdRunnerProbe = true
    cmdRunnerRung = `Bun.which -> ${viaWhich}`
    return true
  }
  try {
    const dirs = probeDirs()
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
    Log.Default.warn("cmd_runner not found (PATH + beside the binary) — crash-prone commands will be BLOCKED (fail-closed)")
  }
  return cmdRunnerProbe
}

/** True when the command hits a crash-prone binary and is not already inside cmd_runner. */
export function shouldRouteViaCmdRunner(command: string): boolean {
  if (VIA_CMD_RUNNER.test(command)) return false
  const match = command.match(CRASH_PRONE_RE)
  if (!match) return false
  // bun is a full member of the class (carve-out retired 2026-09-18).
  // `bun typecheck` → `tsgo --noEmit` prints NOTHING on success and `bun build`
  // runs for minutes: the exact class this guard exists for. The old "bun test
  // only" exception (user directive 2026-09-09) left them bare and exposed to
  // the background-job stall heartbeat, which auto-kills a silent child at 120s.
  // FAIL-CLOSED (2026-09-18): availability is NOT part of routing. The old
  // graceful skip let a missing wrapper disable the whole guard silently;
  // now the absence surfaces in enforceBinaryViaCmdRunner as a BLOCK.
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
  // No wrapper binary → do not wrap (the shell would only say "not found");
  // stay bare so enforceBinaryViaCmdRunner throws with the real reason.
  if (!cmdRunnerAvailable()) return { command, wrapped: false }
  return { command: `cmd_runner start -- ${command}`, wrapped: true }
}

/** Binary+argv form of {@link autoWrapCmdRunner} for the run tool. */
export function autoWrapBinary(
  binary: string,
  args: string[],
): { binary: string; args: string[]; wrapped: boolean } {
  if (!shouldRouteViaCmdRunner([binary, ...args].join(" "))) return { binary, args, wrapped: false }
  if (!cmdRunnerAvailable()) return { binary, args, wrapped: false }
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
  const hint = cmdRunnerAvailable()
    ? `Use: cmd_runner start -- ${match} <args...>`
    : `cmd_runner was NOT found (searched PATH and beside the binary) — the command is ` +
      `blocked rather than run bare. Install or locate cmd_runner, then retry.`
  throw new Error(
    `constitution: ${match} must run through cmd_runner for process isolation. ${hint}`,
  )
}
