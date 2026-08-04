/**
 * Shared constitution preflight for shell/binary tools.
 *
 * Four independent permission groups (never share settings):
 *   destructive-file   — rm -rf, disk wipe
 *   destructive-db     — DROP TABLE/DATABASE, TRUNCATE
 *   destructive-git    — force-push, clean -f; hard-block checkout/stash pop
 *   destructive-fossil — agent fossil mutate (hard-block)
 */
import { Effect } from "effect"
import { Constitution } from "@/session/constitution"
import type * as Tool from "./tool"

const CMD_RUNNER_SEND_PAYLOAD = /^(cmd_runner(?:\.exe)?\s+send\s+.*?--\s*)(.*)/s

/** Strip cmd_runner send payload — the remote code after `--` must not be scanned by constitution or tree-sitter. */
export function stripCmdRunnerSendPayload(command: string): string {
  const m = command.match(CMD_RUNNER_SEND_PAYLOAD)
  return m ? m[1] : command
}

/** Hard-block VCS rewrite / fossil mutate; ask for other DESTRUCTIVE by family. */
export function enforceDestructiveShell(
  command: string,
  ctx: Tool.Context,
  description?: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const guard = Constitution.guardCommand(command, {
      sessionID: ctx.sessionID,
      agent: ctx.extra?.agent as string | undefined,
    })
    // throw (defect) keeps execute error channel `never` — do not Effect.fail
    if (guard.blocked) {
      throw new Error(guard.message ?? "constitution: command blocked")
    }
    if (!guard.needsDestructivePermission) return
    const permission = guard.permission ?? "destructive-file"
    const pattern = command.slice(0, 160)
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
  })
}

/**
 * Crash-prone build toolchains that can corrupt ConPTY / shared console state.
 * Must run through cmd_runner for process isolation. Sorted longest-first so
 * regex alternation matches `clang++` before `clang`.
 */
const CRASH_PRONE_BINARIES = [
  "clang\\+\\+",
  "clang",
  "rustc",
  "cargo",
  "zig",
  "dotnet",
  "msbuild",
  "ninja",
  "cmake",
  "make",
  "g\\+\\+",
  "gcc",
  "go",
  "bun",
] as const

const CRASH_PRONE_RE = new RegExp(
  `(?:^|[;&|]\\s*)\\b(?:${CRASH_PRONE_BINARIES.join("|")})(?:\\.exe)?\\b(?![^\\s]*--)`,
  "i",
)

const VIA_CMD_RUNNER = /\bcmd_runner(?:\.exe)?\b/i

/**
 * Block direct execution of crash-prone build toolchains through bash/cmd/run.
 * These tools can produce raw ANSI/binary output or crash, corrupting ConPTY
 * state and taking down the TUI. They must run through cmd_runner for isolation.
 * `cmd_runner start -- zig build ...` is allowed.
 */
export function enforceBinaryViaCmdRunner(command: string): void {
  if (CRASH_PRONE_RE.test(command) && !VIA_CMD_RUNNER.test(command)) {
    const match = command.match(CRASH_PRONE_RE)?.[0]?.trim() ?? "binary"
    throw new Error(
      `constitution: ${match} must run through cmd_runner for process isolation. ` +
      `Use: cmd_runner start -- ${match} <args...>`,
    )
  }
}

/** @deprecated Use {@link enforceBinaryViaCmdRunner} instead. */
export const enforceBunViaCmdRunner = enforceBinaryViaCmdRunner
