import fs from "fs/promises"
import os from "os"
import path from "path"

/**
 * Home purity guard — shared scanner.
 *
 * Portability doctrine (Local_Development): opencode and its tests must
 * NEVER write to the real user home (os.homedir()). The worktree owns all
 * state under its own .opencode/data, the executable dir owns config, and
 * the harness (test/preload.ts) redirects XDG and OPENCODE_TEST env vars
 * into the worktree temp. These helpers serve the aa/zz purity pair.
 */

/** Third-party churn roots — other processes write here constantly
 * (IDE and browser caches, toolchain homes). Descending would make the
 * guard flaky on writes that are not ours. Our writers never target them. */
export const SKIP_DIRS = new Set([
  "appdata",
  "library",
  ".cache",
  ".npm",
  ".bun",
  ".cargo",
  ".rustup",
  ".vscode",
  ".vscode-server",
  "node_modules",
  ".git",
])

/** Bounded walk: home trees can be enormous, so the guard descends at most
 * MAX_DEPTH levels and collects at most MAX_ENTRIES paths. */
export const MAX_DEPTH = 3
export const MAX_ENTRIES = 50_000

/** Standard opencode home locations — any of these appearing is a violation
 * even if the entry cap cut the walk short. */
export const SENTINELS = [
  ".opencode",
  path.join(".config", "opencode"),
  path.join(".local", "share", "opencode"),
  path.join(".local", "state", "opencode"),
  path.join(".cache", "opencode"),
  path.join("Library", "Application Support", "opencode"),
  path.join("Library", "Caches", "opencode"),
]

export interface HomeSnapshot {
  /** Relative paths seen by the bounded walk (may be truncated). */
  paths: Set<string>
  /** Complete top-level entry names — always deterministic. */
  topLevel: Set<string>
  /** True when the walk hit the entry cap — deep diff is then unreliable. */
  truncated: boolean
  at: number
}

async function listTopLevel(root: string): Promise<Set<string>> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  return new Set(entries.map((entry) => entry.name))
}

export async function scanHome(root: string): Promise<HomeSnapshot> {
  const topLevel = await listTopLevel(root)
  const paths = new Set<string>()
  let truncated = false
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  while (queue.length > 0 && !truncated) {
    const { dir, depth } = queue.pop()!
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      // Unreadable entry (OS permission) — outside our write contract.
      console.debug("home-purity: unreadable entry skipped", dir)
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        if (paths.size >= MAX_ENTRIES) {
          truncated = true
          break
        }
        paths.add(path.relative(root, full))
        if (depth < MAX_DEPTH) queue.push({ dir: full, depth: depth + 1 })
      } else if (entry.isFile()) {
        if (paths.size >= MAX_ENTRIES) {
          truncated = true
          break
        }
        paths.add(path.relative(root, full))
      }
    }
  }
  // Sentinels must always be decided, even when the cap truncated the walk.
  for (const rel of SENTINELS) {
    try {
      await fs.access(path.join(root, rel))
      paths.add(rel)
    } catch {
      paths.delete(rel)
    }
  }
  return { paths, topLevel, truncated, at: Date.now() }
}

export const homeRoot = (): string => os.homedir()
