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

const BUN_DIRECT = /(?:^|[;&|]\s*)\bbun(?:\.exe)?\b(?![^\s]*--)/i
const VIA_CMD_RUNNER = /\bcmd_runner(?:\.exe)?\b/i

/**
 * Block direct `bun` execution through bash/cmd/run — bun is crash-prone
 * and must run through cmd_runner for process isolation.
 * `cmd_runner start -- bun ...` is allowed.
 */
export function enforceBunViaCmdRunner(command: string): void {
  if (BUN_DIRECT.test(command) && !VIA_CMD_RUNNER.test(command)) {
    throw new Error(
      "constitution: bun must run through cmd_runner for process isolation. " +
      'Use: cmd_runner start -- bun <args...>',
    )
  }
}
