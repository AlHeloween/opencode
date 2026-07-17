/**
 * TUI footer VCS/snapshot indicator helpers.
 *
 * Three independent systems (do not conflate):
 * - **Snapshot (agent undo)**: Fossil sidecar under `.opencode/data/fossil/{id}/snapshot.fsl`
 *   and optional worktree open markers `_FOSSIL_` / `_fossil`. Independent of project git.
 * - **Project VCS**: `.git` — source control / branch (red when no snapshot fossil shown).
 * - **jj**: `.jj` — footer display only; not the snapshot backend.
 *
 * A git monorepo still uses Fossil for agent undo. Prefer showing fossil green when the
 * sidecar exists even if git is also present and even if `fossil open` has not left a
 * checkout marker yet.
 */
import { existsSync, readdirSync } from "fs"
import * as nodePath from "path"

export type IndicatorBackend = "jj" | "fossil" | "git"

/** True when agent-undo Fossil is present (open markers or sidecar repo file). */
export function hasFossilSnapshot(worktree: string): boolean {
  if (existsSync(nodePath.join(worktree, "_FOSSIL_"))) return true
  if (existsSync(nodePath.join(worktree, "_fossil"))) return true

  const fossilRoot = nodePath.join(worktree, ".opencode", "data", "fossil")
  if (!existsSync(fossilRoot)) return false

  try {
    for (const name of readdirSync(fossilRoot)) {
      if (existsSync(nodePath.join(fossilRoot, name, "snapshot.fsl"))) return true
    }
  } catch {
    return false
  }
  return false
}

/**
 * Primary footer label.
 * Priority: jj checkout → fossil snapshot (sidecar or open) → project git.
 * Git `index.lock` and other git health must not gate fossil detection.
 */
export function detectIndicatorBackend(worktree: string): IndicatorBackend | null {
  if (existsSync(nodePath.join(worktree, ".jj"))) return "jj"
  if (hasFossilSnapshot(worktree)) return "fossil"
  if (existsSync(nodePath.join(worktree, ".git"))) return "git"
  return null
}

export function indicatorColor(backend: IndicatorBackend | null): string {
  switch (backend) {
    case "jj":
      return "#88c0d0"
    case "fossil":
      return "#a3be8c"
    case "git":
      return "#bf616a"
    default:
      return "#4c566a"
  }
}
