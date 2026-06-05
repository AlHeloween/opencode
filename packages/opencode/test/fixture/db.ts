import { rm } from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Database } from "@/storage/db"
import { getProjectWorktrees, clearProjectWorktrees } from "../../src/project/project"

export async function resetDatabase() {
  const worktrees = new Set(getProjectWorktrees().values())
  await Instance.disposeAll().catch(() => undefined)
  clearProjectWorktrees()
  Database.close()
  for (const worktree of worktrees) {
    const dbPath = Database.getProjectDbPath(worktree)
    await rm(dbPath, { force: true }).catch(() => undefined)
    await rm(`${dbPath}-wal`, { force: true }).catch(() => undefined)
    await rm(`${dbPath}-shm`, { force: true }).catch(() => undefined)
  }
}
