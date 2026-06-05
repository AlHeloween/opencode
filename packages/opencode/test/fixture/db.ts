import { rm } from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Database } from "@/storage/db"
import { clearProjectWorktrees } from "../../src/project/project"

export async function resetDatabase() {
  await Instance.disposeAll().catch(() => undefined)
  clearProjectWorktrees()
  Database.close()
  const dir = Instance.currentMaybe?.worktree
  if (!dir) return
  const dbPath = Database.getProjectDbPath(dir)
  await rm(dbPath, { force: true }).catch(() => undefined)
  await rm(`${dbPath}-wal`, { force: true }).catch(() => undefined)
  await rm(`${dbPath}-shm`, { force: true }).catch(() => undefined)
}
