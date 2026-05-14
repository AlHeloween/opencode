import { Database } from "@/storage/db"
import { Instance } from "@/project/instance"

export function use<T>(
  fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T,
): T {
  const ctx = Instance.currentMaybe
  if (!ctx || !Database.usesProjectDb(ctx.worktree)) return Database.use(fn)
  return Database.withProject(ctx.project.id, ctx.worktree, () => Database.use(fn))
}

export function transaction<T>(
  fn: (d: Parameters<typeof Database.transaction>[0] extends (trx: infer D) => any ? D : never) => T,
  options?: { behavior?: "deferred" | "immediate" | "exclusive" },
): T {
  const ctx = Instance.currentMaybe
  if (!ctx || !Database.usesProjectDb(ctx.worktree)) return Database.transaction(fn as any, options)
  return Database.withProject(ctx.project.id, ctx.worktree, () =>
    Database.transaction(fn as any, options),
  )
}
