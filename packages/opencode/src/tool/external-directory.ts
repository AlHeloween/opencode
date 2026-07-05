import path from "path"
import { Effect } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { InstanceState } from "@/effect/instance-state"
import type * as Tool from "./tool"
import { Instance } from "../project/instance"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"

type Kind = "file" | "directory"

export type ExternalDirMode = "deny" | "ask" | "allow"

type Options = {
  bypass?: boolean
  kind?: Kind
}

export const assertExternalDirectoryEffect = Effect.fn("Tool.assertExternalDirectory")(function* (
  ctx: Tool.Context,
  target?: string,
  options?: Options,
) {
  if (!target) return
  if (options?.bypass) return

  const ins = yield* InstanceState.context
  const full = AppFileSystem.resolve(target)
  if (Instance.containsPath(full, ins)) return

  // Check config mode: "deny" | "ask" | "allow"
  const cfg = yield* Effect.serviceOption(Config.Service)
  const mode: ExternalDirMode = cfg._tag === "Some"
    ? ((yield* cfg.value.get()).external_directory_mode as ExternalDirMode) ?? "ask"
    : "ask"

  if (mode === "allow") return
  if (mode === "deny") throw new Error(`External directory access denied: ${full}`)

  // mode === "ask" — prompt user
  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? full : path.dirname(full)
  const glob = path.join(dir, "*")

  yield* ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: full,
      parentDir: dir,
    },
  })
})

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  return Effect.runPromise(assertExternalDirectoryEffect(ctx, target, options).pipe(Effect.provide(EffectLogger.layer)))
}
