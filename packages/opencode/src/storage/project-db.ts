import { Database } from "@/storage/db"
import { Instance } from "@/project/instance"

export function use<T>(
  fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T,
): T {
  if (!Database.isProjectDbMode()) return Database.use(fn)
  try {
    return Database.withProject(Instance.project.id, Instance.worktree, () => Database.use(fn))
  } catch {
    return Database.use(fn)
  }
}

export function transaction<T>(
  fn: (d: Parameters<typeof Database.transaction>[0] extends (trx: infer D) => any ? D : never) => T,
  options?: { behavior?: "deferred" | "immediate" | "exclusive" },
): T {
  if (!Database.isProjectDbMode()) return Database.transaction(fn as any, options)
  try {
    return Database.withProject(Instance.project.id, Instance.worktree, () =>
      Database.transaction(fn as any, options),
    )
  } catch {
    return Database.transaction(fn as any, options)
  }
}
