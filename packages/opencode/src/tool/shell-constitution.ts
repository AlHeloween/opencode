/**
 * Shared constitution preflight for shell/binary tools.
 *
 * - git checkout/switch/restore/reset --hard: HARD BLOCK (use edit.bak / fossil)
 * - other DESTRUCTIVE: permission "destructive" (not bash/cmd/run wildcards)
 */
import { Effect } from "effect"
import { Constitution } from "@/session/constitution"
import type * as Tool from "./tool"

/** Hard-block VCS rewrite; ask for other DESTRUCTIVE; no-op for safe commands. */
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
    const pattern = command.slice(0, 160)
    yield* ctx.ask({
      permission: "destructive",
      patterns: [pattern],
      always: [pattern],
      metadata: {
        risk: "DESTRUCTIVE",
        constitution: true,
        message: guard.message,
        command: command.slice(0, 400),
        description,
      },
    })
  })
}
