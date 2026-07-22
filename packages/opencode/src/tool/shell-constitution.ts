/**
 * Shared constitution preflight for shell/binary tools.
 * DESTRUCTIVE commands (rm -rf, force-push, reset --hard, git checkout/switch/restore, …)
 * require permission "destructive" — not covered by bash/cmd/run wildcards.
 */
import { Effect } from "effect"
import { Constitution } from "@/session/constitution"
import type * as Tool from "./tool"

/** Ask for destructive permission when constitution classifies the command as DESTRUCTIVE. */
export function enforceDestructiveShell(
  command: string,
  ctx: Tool.Context,
  description?: string,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const guard = Constitution.guardCommand(command, {
      sessionID: ctx.sessionID,
      agent: ctx.extra?.agent as string | undefined,
    })
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
