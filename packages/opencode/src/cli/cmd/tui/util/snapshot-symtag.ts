/**
 * Snapshot impact for the TUI footer — read from what EXISTS.
 *
 * This used to read a fossil `sym` tag. Measured 2026-09-29: the live tag is
 * EMPTY (`sym=KINDS:none|TOP:none|XF:0` on both the checkout and its parent), so
 * `totalSymbols` was 0 and the footer rendered NOTHING — the display had been
 * dead while the tag existed. The tag is also no longer written: C1 took the
 * CodeGraph MCP touch off the commit path (2.4 s per call) because the value it
 * produced is consumed by the SUMMARY, twenty minutes later.
 *
 * So both halves now come from the two sources the owner named — «fossil нам
 * нужен только чтобы показать краткий бриф изменений, а codegraph покажет
 * реальные»:
 *
 *   BRIEF  — `fossil info` gives checkout/parent; `fossil diff --brief` between
 *            them is the file list of the LAST snapshot, shell-made edits included.
 *   IMPACT — the CodeGraph SQLite pack over those files, READONLY and WITHOUT the
 *            MCP touch: a footer must not pay a live process a 2.4 s round-trip.
 *
 * Everything here is synchronous (~20 ms fossil + ~200 ms pack) and runs once per
 * worktree change through the footer's `createResource`.
 */
import { execFileSync } from "child_process"
import { existsSync } from "fs"
import * as nodePath from "path"
import { hasFossilSnapshot } from "./vcs-indicator"
import { packGraphForFiles, packToImpactFields } from "@/codegraph/sqlite-pack"

export interface SnapshotImpactInfo {
  /** Files the LAST snapshot changed — `fossil diff --brief` between parent and checkout. */
  changedFiles: string[]
  /** Symbol counts by kind from the CodeGraph SQLite pack. Empty when the graph holds none of the files. */
  symbolCountByKind: Record<string, number>
  topSymbols: string[]
  totalSymbols: number
  /** The graph could not be read (no index / no DB / unreadable). The brief is still true. */
  impactUnavailable: boolean
}

/**
 * Find the fossil binary. Order matters and it is measured, not guessed:
 * a test run under `bun` has `process.execPath` = bun, and a source-run has it
 * pointing at bun too — so the executable-adjacent candidates alone make this
 * reader answer `null` outside the shipped layout. That is a tool working on
 * PART of its domain, which @TOOLCHAIN_QUALIFICATION calls broken, so the two
 * in-repo locations the project documents (`external/fossil/fossil.exe`,
 * `tools/fossil.exe`) are consulted before PATH.
 */
function findFossil(worktree: string): string | null {
  const candidates: string[] = []

  // Tools directory next to the executable (the shipped layout: bin/opencode.exe + bin/tools)
  const execPath = process.execPath
  if (execPath) {
    const toolsDir = nodePath.join(nodePath.dirname(execPath), "tools")
    candidates.push(
      nodePath.join(toolsDir, "fossil.exe"),
      nodePath.join(toolsDir, "fossil"),
    )
  }

  // In-repo locations — the ones AGENTS.md documents for this project.
  candidates.push(
    nodePath.join(worktree, "tools", "fossil.exe"),
    nodePath.join(worktree, "external", "fossil", "fossil.exe"),
  )

  // PATH fallback
  candidates.push("fossil", "fossil.exe")

  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

/**
 * `checkout:` and `parent:` out of `fossil info`. Pure, so it is testable without
 * a repository — and the shapes below are the ones measured on the live repo
 * (2026-09-29): `checkout:     82eca50b… 2026-09-29 18:36:28 UTC`.
 */
export function parseFossilInfo(text: string): { checkout?: string; parent?: string } {
  return {
    checkout: text.match(/^checkout:\s+([a-f0-9]+)/m)?.[1]?.trim(),
    parent: text.match(/^parent:\s+([a-f0-9]+)/m)?.[1]?.trim(),
  }
}

/**
 * Paths out of `fossil diff --brief`, whose lines read `EDITED path`, `ADDED path`,
 * `DELETED path`. Same shape `snapshot/fossil.ts` parses on the commit path.
 */
export function parseBriefPaths(text: string): string[] {
  return text
    .trim()
    .split("\n")
    .map((l) => l.replace(/^[A-Z]+\s+/, "").trim())
    .filter((f) => f.length > 0)
    .map((f) => f.replace(/\\/g, "/"))
}

export function readSnapshotImpact(worktree: string): SnapshotImpactInfo | null {
  if (!hasFossilSnapshot(worktree)) return null

  const fossilBin = findFossil(worktree)
  if (!fossilBin) return null

  const run = (args: string[]): string | null => {
    try {
      return execFileSync(fossilBin, args, {
        cwd: worktree,
        encoding: "utf-8",
        timeout: 5000,
      })
    } catch (err) {
      // Expected when the checkout is mid-write or fossil is unavailable; the
      // caller renders a null rather than a false claim about impact.
      console.debug("snapshot impact: fossil call failed", { args: args.join(" "), err })
      return null
    }
  }

  const info = run(["info"])
  if (!info) return null
  const { checkout, parent } = parseFossilInfo(info)
  if (!checkout) return null

  // No parent = the first check-in of a repository: nothing to diff against.
  const brief = parent ? run(["diff", "--from", parent, "--to", checkout, "--brief"]) : null
  const changedFiles = brief ? parseBriefPaths(brief) : []

  // The impact is best-effort by design: the footer shows the brief even when the
  // graph cannot answer, and says so instead of rendering an empty claim.
  let symbolCountByKind: Record<string, number> = {}
  let topSymbols: string[] = []
  let impactUnavailable = changedFiles.length > 0
  if (changedFiles.length > 0) {
    try {
      const pack = packGraphForFiles(worktree, changedFiles)
      const fields = packToImpactFields(pack)
      symbolCountByKind = fields.symbolCountByKind
      topSymbols = fields.topSymbols
      impactUnavailable = false
    } catch (err) {
      // The graph is outside the footer's authority to repair: report the brief,
      // never a fabricated impact.
      console.debug("snapshot impact: codegraph pack unavailable", { err })
      impactUnavailable = true
    }
  }

  return {
    changedFiles,
    symbolCountByKind,
    topSymbols,
    totalSymbols: Object.values(symbolCountByKind).reduce((a, b) => a + b, 0),
    impactUnavailable,
  }
}
