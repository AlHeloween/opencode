/**
 * TUI-friendly fossil sym tag reader.
 *
 * Synchronous subprocess call to `fossil tag list` — fast (~20ms),
 * suitable for footer rendering. Returns parsed structural metadata
 * from the P0 codegraph sym tag, or null if unavailable.
 */
import { execFileSync } from "child_process"
import { existsSync } from "fs"
import * as nodePath from "path"
import { hasFossilSnapshot } from "./vcs-indicator"

export interface SymTagInfo {
  /** Symbol counts by kind, e.g. { function: 5, class: 3 } */
  symbolCountByKind: Record<string, number>
  /** Top symbols changed (name + kind), e.g. ["guardCommand[fn]", "allowDestructiveCommands[fn]"] */
  topSymbols: string[]
  /** Files outside the change set impacted by these changes */
  impactedFiles: string[]
  /** Total symbols tracked (sum of all kinds) */
  totalSymbols: number
}

/** Find fossil binary: try tools/ next to executable, then PATH. */
function findFossil(): string | null {
  const candidates: string[] = []

  // Tools directory next to the executable
  const execPath = process.execPath
  if (execPath) {
    const toolsDir = nodePath.join(nodePath.dirname(execPath), "tools")
    candidates.push(
      nodePath.join(toolsDir, "fossil.exe"),
      nodePath.join(toolsDir, "fossil"),
    )
  }

  // PATH fallback
  candidates.push("fossil", "fossil.exe")

  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

/** Get current fossil checkout hash via `fossil info`. */
function currentFossilHash(fossilBin: string, worktree: string): string | null {
  try {
    const out = execFileSync(fossilBin, ["info"], {
      cwd: worktree, encoding: "utf-8", timeout: 5000,
    })
    const m = out.match(/^checkout:\s+([a-f0-9]+)/m) ?? out.match(/^hash:\s+([a-f0-9]+)/m)
    return m?.[1]?.trim().slice(0, 40) ?? null
  } catch {
    return null
  }
}

/**
 * Read the sym tag from the current fossil commit.
 * Returns structured metadata or null if the tag doesn't exist.
 */
export function readSymTag(worktree: string): SymTagInfo | null {
  if (!hasFossilSnapshot(worktree)) return null

  const fossilBin = findFossil()
  if (!fossilBin) return null

  const hash = currentFossilHash(fossilBin, worktree)
  if (!hash) return null

  try {
    const out = execFileSync(fossilBin, ["tag", "list", hash], {
      cwd: worktree, encoding: "utf-8", timeout: 5000,
    })

    // Parse sym line: "sym  KINDS:method=224,class=32|TOP:...|IMPACT:..."
    const symLine = out.split("\n").find((l) => l.startsWith("sym "))
    if (!symLine) return null

    const tagValue = symLine.replace(/^sym\s+/, "").trim()
    if (!tagValue) return null

    const symbolCountByKind: Record<string, number> = {}
    const kindSection = tagValue.match(/KINDS:([^|]*)/)?.[1]
    if (kindSection) {
      for (const pair of kindSection.split(",")) {
        const [k, v] = pair.split("=")
        if (k && v) symbolCountByKind[k] = parseInt(v) || 0
      }
    }

    const topSection = tagValue.match(/TOP:([^|]*)/)?.[1]
    const topSymbols = topSection ? topSection.split(",").filter(Boolean) : []

    const impactSection = tagValue.match(/IMPACT:([^|]*)/)?.[1]
    const impactedFiles = impactSection ? impactSection.split(",").filter(Boolean) : []

    const totalSymbols = Object.values(symbolCountByKind).reduce((a, b) => a + b, 0)

    return { symbolCountByKind, topSymbols, impactedFiles, totalSymbols }
  } catch {
    return null
  }
}
