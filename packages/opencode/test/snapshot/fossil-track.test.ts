/**
 * Fossil smoke test — verifies the fossil binary works correctly.
 *
 * Workflow: init → open --force → commit --allow-empty (baseline)
 * → add → commit → modify → commit --hash → close+open → commit.
 *
 * The close+open cycle is the documented fix for "Unresolved RID values"
 * (stale checkout DB after repo replacement). The --hash flag ensures
 * reliable change detection on Windows (bypasses mtime issues).
 */
import { describe, expect, test } from "bun:test"
import { execFileSync } from "child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs"
import path from "path"
import os from "os"

const FOSSIL = path.resolve(import.meta.dirname!, "..", "..", "..", "..", "external", "fossil", "fossil.exe")
if (!existsSync(FOSSIL)) throw new Error("fossil not found: " + FOSSIL)

function fossil(args: string[], cwd: string): string {
  try {
    return execFileSync(FOSSIL, args, { cwd, encoding: "utf8", timeout: 5000 })
  } catch (err) {
    const error = err as { stderr?: string; message?: string }
    throw new Error(`fossil ${args.join(" ")} failed: ${error.stderr ?? error.message ?? "unknown error"}`)
  }
}

describe("fossil smoke", () => {
  test("init, commit x2, close+open, commit — all functional", () => {
    const tmp = path.join(os.tmpdir(), "fst_" + Date.now())
    mkdirSync(tmp, { recursive: true })
    try {
      fossil(["init", "r.fsl"], tmp)
      fossil(["open", "r.fsl", "--force", "--keep"], tmp)
      expect(fossil(["commit", "-m", "init", "--no-warnings", "--allow-fork", "--allow-empty", "--hash"], tmp)).toContain("New_Version:")
      expect(fossil(["info"], tmp)).toMatch(/checkout:\s+[a-f0-9]+/)

      // First file commit
      writeFileSync(path.join(tmp, "f.txt"), "v1")
      fossil(["add", "f.txt"], tmp)
      const r1 = fossil(["commit", "-m", "c1", "--no-warnings", "--allow-fork"], tmp)
      expect(r1).toContain("New_Version:")

      // Close+open cycle (proven fix for Unresolved RID)
      fossil(["close", "--force"], tmp)
      fossil(["open", "r.fsl", "--force", "--keep"], tmp)

      // Modify and commit with --hash for reliable Windows detection
      writeFileSync(path.join(tmp, "f.txt"), "v2")
      const r2 = fossil(["commit", "-m", "c2", "--no-warnings", "--allow-fork", "--hash"], tmp)
      expect(r2).toContain("New_Version:")

      fossil(["close", "--force"], tmp)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }, 10000)
})
