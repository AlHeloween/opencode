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
import { CMD_FILES, CMD_SAFE, CWD, FILES, POWERSHELL_FILES, POWERSHELL_SAFE, SAFE } from "./shell-sets"

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
      // An enumerator's block carries its own reason from Constitution.evaluate — the same predicate
      // guardCommand uses. It used to be rebuilt here from the resolver, whose message is "" whenever
      // the tool RESOLVES, so a blocked `dir`/`cat` threw `Error("")` (2026-09-29).
      const msg = finding.isFileEnumerator
        ? (finding.message ?? "constitution: BLOCKED directory/file enumeration")
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
 *
 * `opts.argv` passes through to guardCommand: the command is binary+argv (run tool) — the
 * argument contents are data, never shell segments.
 */
export function enforceDestructiveShell(
  command: string,
  ctx: Tool.Context,
  description?: string,
  opts?: { argv?: boolean },
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const split = splitCmdRunnerSend(command)
    const guard = Constitution.guardCommand(
      split.shellScan,
      {
        sessionID: ctx.sessionID,
        agent: ctx.extra?.agent as string | undefined,
      },
      opts,
    )
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

// ============================================================================
// Unknown-app safe launch (owner directive 2026-10-06):
// any executable other than the known tools (bin/** + git/python/node/pwsh/cmd)
// is crash-prone — a freshly built app can crash on a bug OR hang waiting on
// input, and a bare hang took the agent's TUI and its logs with it (no trace
// left to read). Unknown apps get the same route as the crash-prone list:
// auto-wrapped into `cmd_runner start -- …`; refused (fail-closed) without it.
// ============================================================================

/** Tools shipped in the repo's bin/** (bin/ + bin/tools/) — known, may run bare. */
const KNOWN_BIN_TOOLS = [
  "cmd_runner", "adm", "adm-rag", "apply_patch", "rg", "fd", "fossil", "grep", "sed",
  "rclone", "ambr", "ambs", "awk", "cat", "find", "ls", "head", "tail", "sort", "wc",
  "sqlite3", "sqlite3_analyzer", "sqlite3_rsync", "sqldiff", "ffmpeg", "ffplay", "ffprobe",
  "opencode", "opencode-markdownify", "consolecompare", "cua-driver", "cua-driver-uia",
  "codegraph", "node",
] as const

/** System minimum (owner-approved scope): these stay allowed bare. */
const SYSTEM_KNOWN_TOOLS = ["git", "python", "python3", "node", "pwsh", "powershell", "cmd"] as const

const KNOWN_TOOLS: ReadonlySet<string> = new Set([...KNOWN_BIN_TOOLS, ...SYSTEM_KNOWN_TOOLS])

/** Bare crash-prone names (normalized) — paths to these keep the old, unwrapped behaviour. */
const CRASH_PRONE_NAMES: ReadonlySet<string> = new Set(
  CRASH_PRONE_BINARIES.map((n) => n.replace(/\\/g, "").toLowerCase()),
)

/**
 * Shell builtins / known-safe command words — not executables, so the unknown-app
 * rule must not wrap them (`cd repo && echo ok` stays bare). Seeded from the
 * shell-sets.ts safe lists plus the cmd.exe / POSIX builtins those lists omit.
 */
const NON_APP_HEADS: ReadonlySet<string> = new Set([
  ...CWD, ...FILES, ...SAFE, ...CMD_SAFE, ...CMD_FILES, ...POWERSHELL_SAFE, ...POWERSHELL_FILES,
  "assoc", "break", "call", "chdir", "cls", "date", "endlocal", "erase", "exit", "for", "ftype",
  "goto", "if", "md", "mklink", "pause", "rem", "rename", "set", "setlocal", "shift", "start",
  "time", "title", "ver", "verify", "vol", "help", "where",
  ".", ":", "[", "alias", "bg", "bind", "builtin", "caller", "command", "compgen", "complete",
  "continue", "declare", "dirs", "disown", "enable", "eval", "exec", "export", "fc", "fg",
  "getopts", "hash", "history", "jobs", "kill", "let", "local", "logout", "mapfile", "popd",
  "pushd", "pwd", "read", "readonly", "return", "shopt", "source", "suspend", "test",
  "times", "trap", "typeset", "ulimit", "umask", "unalias", "unset", "wait",
])

const SHELL_SEGMENT_SPLIT = /(?:\s*(?:&&|\|\||[;&|])\s*)/

/** First word of every `;`/`&`/`|` segment — the only words that can name an app. */
function headTokens(command: string): string[] {
  return command
    .split(SHELL_SEGMENT_SPLIT)
    .map((segment) => {
      const trimmed = segment.trim()
      // A quoted head (`"C:\Program Files\...\pwsh.exe" -Command …`) is ONE token:
      // splitting on whitespace first tore it at the space and wrapped a bare path.
      const quoted = trimmed.match(/^(["'])((?:(?!\1).)*)\1/)
      return quoted ? `${quoted[1]}${quoted[2]}${quoted[1]}` : (trimmed.split(/\s+/)[0] ?? "")
    })
    .filter(Boolean)
}

/** De-quote, take the basename, drop the exec extension — a normalized tool name. */
function toolName(token: string): string {
  const unquoted = token.replace(/^["']+|["']+$/g, "")
  const base = unquoted.split(/[\\/]/).pop() ?? unquoted
  return base.toLowerCase().replace(/\.(exe|com|bat|cmd|ps1)$/, "")
}

/** True for a segment head that is an executable we do not know and have not tested. */
function isUnknownAppToken(token: string): boolean {
  const raw = token.replace(/^["']+|["']+$/g, "")
  if (!raw) return false
  if (/^[-<>#@%$(!]/.test(raw)) return false // option / redirect / env var / comment
  if (/^\d+$/.test(raw)) return false // `2>&1` leftovers
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) return false // VAR=value
  // Only a FILE is an app for this rule: a path or an exec-suffixed name. A bare
  // command word (`ping`, `Get-Date`, `mytool`) is not wrapped — its permission
  // flow stays exactly as before (bash.test.ts «asks for the permission…»).
  const isFile = /[\\/]/.test(raw) || /\.(exe|com|bat|cmd|ps1)$/i.test(raw)
  if (!isFile) return false
  const name = toolName(raw)
  if (!name) return false
  // Paths to the KNOWN crash-prone runners (`C:\…\bun.exe -e …`) keep their existing
  // behaviour: only BARE forms are routed by CRASH_PRONE_RE, and the truncation suite
  // depends on that (a wrapped session returns session output, not the command's own
  // stream). Extending the rule to those paths means reworking the wrapped-output
  // contract — a separate task.
  if (CRASH_PRONE_NAMES.has(name)) return false
  return !NON_APP_HEADS.has(name) && !KNOWN_TOOLS.has(name)
}

/** True when any segment head is an unknown app — the whole command gets safe-launched. */
function containsUnknownApp(command: string): boolean {
  return headTokens(command).some(isUnknownAppToken)
}

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
  // FAIL-CLOSED (2026-09-18): availability is NOT part of routing. The old
  // graceful skip let a missing wrapper disable the whole guard silently;
  // now the absence surfaces in enforceBinaryViaCmdRunner as a BLOCK.
  if (command.match(CRASH_PRONE_RE)) {
    // bun is a full member of the class (carve-out retired 2026-09-18).
    // `bun typecheck` → `tsgo --noEmit` prints NOTHING on success and `bun build`
    // runs for minutes: the exact class this guard exists for. The old "bun test
    // only" exception (user directive 2026-09-09) left them bare and exposed to
    // the background-job stall heartbeat, which auto-kills a silent child at 120s.
    return true
  }
  // Unknown app (owner directive 2026-10-06): anything outside the known set is a
  // crash/hang risk — the agent built an app, ran it bare, it hung, and the TUI
  // went down with the logs. Safe launch = the same cmd_runner route as above.
  return containsUnknownApp(command)
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
