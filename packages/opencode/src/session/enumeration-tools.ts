/**
 * Which unix enumeration tools this runtime can actually run.
 *
 * The constitution blocks `ls` / `find` / `cat`-style enumeration absolutely, and the reason was
 * never the commands themselves: on Windows they are either missing or a cmd builtin with
 * different semantics, so mixing the two toolchains produced errors and wrong decisions (owner,
 * 2026-09-21: «конфликт bash и windows тулзов приводит к ошибкам и неправильному принятию
 * решений»). An absolute block is the wrong shape for that problem — it also blocks the case where
 * the real tool is sitting right there and works.
 *
 * The rule is now conditional. A tool is allowed when it RESOLVES:
 *   1. beside the running executable (the folder the binary lives in),
 *   2. in the worktree's `tools/`,
 *   3. on PATH — but NOT for names Windows ships with different semantics. `where find` finds
 *      `System32\find.exe`, which is a text search and not a directory walker, so PATH is not
 *      evidence for such a name; only a real unix build beside the binary or in `tools/` is.
 * When it does not resolve, the block names both ways out — put the tool beside the binary, or do
 * not use it — instead of pretending the capability does not exist.
 */
import { existsSync } from "node:fs"
import path from "node:path"

/** The commands the enumeration block covers, by the name used on the command line. */
export const ENUMERATION_TOOLS = [
  "ls",
  "dir",
  "tree",
  "find",
  "fd",
  "cat",
  "type",
  "more",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "sed",
  "awk",
  "sort",
  "uniq",
  "cut",
  "xargs",
] as const

export type EnumerationTool = (typeof ENUMERATION_TOOLS)[number]

const KNOWN = new Set<string>(ENUMERATION_TOOLS)

/**
 * Names Windows also ships with DIFFERENT semantics. PATH is not evidence for these: a probe that
 * finds one of them has found the Windows tool, not the unix one.
 */
const PLATFORM_NAMESAKE = new Set(["find", "more", "sort"])

const cache = new Map<string, string | undefined>()

export interface ResolveOptions {
  /** Folder holding the running executable. Defaults to `path.dirname(process.execPath)`. */
  exeDir?: string
  /** Worktree root. Defaults to `process.cwd()`. */
  worktree?: string
  /** Worktree tools folder. Defaults to `<worktree>/tools`. */
  toolsDir?: string
  /** PATH lookup. Defaults to `Bun.which`; injectable so the decision stays testable. */
  which?: (name: string) => string | null
  /** File probe. Defaults to `existsSync`; injectable for the same reason. */
  exists?: (candidate: string) => boolean
}

function defaultWhich(name: string): string | null {
  // Bun ships `which`; under a plain node runtime the probe simply returns nothing.
  const bun = (globalThis as { Bun?: { which?: (name: string) => string | null } }).Bun
  return bun?.which?.(name) ?? null
}

/** Where this runtime finds `name`, or undefined when it finds it nowhere. */
export function resolveEnumerationTool(name: string, options: ResolveOptions = {}): string | undefined {
  const bare = name.replace(/\.exe$/i, "").toLowerCase()
  if (!KNOWN.has(bare)) return undefined

  const cached = cache.get(bare)
  if (cached !== undefined || cache.has(bare)) return cached

  const exists = options.exists ?? existsSync
  const exeDir = options.exeDir ?? path.dirname(process.execPath)
  const toolsDir = options.toolsDir ?? path.join(options.worktree ?? process.cwd(), "tools")
  const candidates = [path.join(exeDir, `${bare}.exe`), path.join(exeDir, bare), path.join(toolsDir, `${bare}.exe`)]
  for (const candidate of candidates) {
    if (exists(candidate)) {
      cache.set(bare, candidate)
      return candidate
    }
  }

  const which = options.which ?? defaultWhich
  // A Windows namesake is a different program under the same name — a real unix build has to sit
  // beside the binary or in tools/ to count, and an absent one is reported as absent rather than
  // shadowed by System32.
  if (process.platform === "win32" && PLATFORM_NAMESAKE.has(bare)) {
    cache.set(bare, undefined)
    return undefined
  }
  const found = which(bare) ?? which(`${bare}.exe`)
  const resolved = found ?? undefined
  cache.set(bare, resolved)
  return resolved
}

export interface EnumerationDecision {
  allowed: boolean
  /** Absolute path of the tool that made it allowed. */
  path?: string
  /** The block message, with the two ways out named. Empty when allowed. */
  message: string
}

/**
 * The decision for one command name. Pure apart from the injected resolver, so the rule is pinned
 * by a test instead of argued over a blocked command.
 */
export function enumerationToolDecision(name: string, options: ResolveOptions = {}): EnumerationDecision {
  const found = resolveEnumerationTool(name, options)
  if (found) return { allowed: true, path: found, message: "" }

  const exeDir = options.exeDir ?? path.dirname(process.execPath)
  const toolsDir = options.toolsDir ?? path.join(options.worktree ?? process.cwd(), "tools")
  const bare = name.replace(/\.exe$/i, "").toLowerCase()
  return {
    allowed: false,
    message:
      `constitution: BLOCKED directory/file enumeration — \`${bare}\` is not available to this runtime. ` +
      `Either put the unix tool beside the binary (${exeDir}) or in ${toolsDir}, or do not use it: ` +
      "the list tool browses, glob finds paths, grep finds content, read reads files. " +
      "VCS checks (e.g. git ls-files --error-unmatch <path>) and PATH lookup (where/which) stay allowed.",
  }
}

/** Test seam: forget every probe result. */
export function resetEnumerationToolCache(): void {
  cache.clear()
}
