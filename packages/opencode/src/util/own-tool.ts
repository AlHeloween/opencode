import path from "path"
import { existsSync } from "node:fs"
import { Global } from "@opencode-ai/core/global"
import { which } from "@/util/which"

/**
 * The robot's OWN tool (samply, cua-driver, …): beside the running executable first, wherever the robot was started.
 *
 * The worktree is the folder the robot was started in (`packages/core/src/global.ts:8`) — a client's project once
 * installed — so `{worktree}/bin/<subdir>` only finds the tool in this repo. Order: `<exeDir>/<subdir>` (installed, and
 * the repo's own `bin/` build, where the exe lives in `bin/`) → `{worktree}/bin/<subdir>` (running from source, the exe
 * is bun) → `Global.Path.bin` → PATH → the bare name, so a spawn error names the missing tool.
 * Plan robot-installer R1 (2026-10-07).
 */
export function resolveOwnTool(input: {
  binary: string
  subdir: string
  exeDir?: string
  worktree: string
  env?: NodeJS.ProcessEnv
}): string {
  const exeDir = input.exeDir ?? path.dirname(process.execPath)
  return (
    [
      path.join(exeDir, input.subdir, input.binary),
      path.join(input.worktree, "bin", input.subdir, input.binary),
      path.join(Global.Path.bin, input.binary),
    ].find((candidate) => existsSync(candidate)) ??
    which(input.binary, input.env) ??
    input.binary
  )
}
