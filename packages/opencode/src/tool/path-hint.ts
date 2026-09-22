/**
 * Path prior for tool JSON Schema descriptions.
 *
 * Models invent foreign absolute paths (C:\Users\other\...) when schema says
 * "must be absolute" with no local prior. Prefer worktree-relative paths;
 * absolute only if under cwd/worktree. Optional cwd line is session-local prior
 * (tools rebuild at init under Instance context).
 *
 * Plan: path prior under worktree (F1) — no turn-envelope / msg-chain here.
 */
import { Instance } from "../project/instance"

function sessionRoots(): { directory?: string; worktree?: string } {
  try {
    return { directory: Instance.directory, worktree: Instance.worktree }
  } catch {
    return {}
  }
}

/** Stable prose prior for path-like tool parameters (LLM-visible schema text). */
export function pathFieldDescription(role: string): string {
  const { directory, worktree } = sessionRoots()
  const parts = [
    `${role}.`,
    "Prefer a path relative to the project working directory (e.g. \"src/foo.ts\", \"experiments/x\").",
    "Absolute paths are allowed only when they resolve under the working directory or worktree.",
    "Do not invent foreign OS user paths (e.g. C:\\Users\\other\\... unrelated to this project).",
  ]
  if (directory) parts.push(`Working directory: ${directory}`)
  if (worktree && worktree !== directory) parts.push(`Worktree: ${worktree}`)
  return parts.join(" ")
}

export function filePathDescription(what = "Path to the file"): string {
  return pathFieldDescription(what)
}

/**
 * True when a tool's `filePath` is a CODE FRAGMENT rather than a path.
 *
 * A malformed tool call hands over the tail of an expression: the measured shape is
 * `i+1).join(String.fromCharCode(10)))`, which produced a 0-byte file in `packages/opencode` on
 * 2026-09-21 — and it is not the first time it appeared there (owner: «этот артефакт появляется там
 * регулярно — это БАГ»).
 *
 * The predicate that stood in `write.ts`/`edit.ts` was «has parens AND has no dot», which every such
 * fragment PASSES, because `.join(` carries the dot — so the guard never fired and the file was
 * created anyway. Recognition is by SHAPE instead: a BARE name (no path separator) that carries
 * punctuation no filename uses. A value WITH a separator is left alone — `src/foo(i).ts` and
 * `./Report (final).md` are real paths, and rejecting them would cost a retry for nothing.
 */
export function looksLikeCodeFragment(value: string): boolean {
  if (/[/\\]/.test(value)) return false
  return /[(){}[\]<>;=+`"']/.test(value)
}

export function directoryPathDescription(what = "Path to the directory"): string {
  return pathFieldDescription(what)
}
