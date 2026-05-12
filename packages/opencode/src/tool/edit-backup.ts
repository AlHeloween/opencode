import path from "path"
import { Effect, Schema } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const BackupEntry = Schema.Struct({
  filename: Schema.String,
  timestamp: Schema.String,
  originalPath: Schema.optional(Schema.String),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type BackupEntry = Schema.Schema.Type<typeof BackupEntry>

function backupDir(sessionID: string) {
  return path.join(Global.Path.data, "backups", sessionID)
}

export const listBackups = Effect.fn("EditBackup.list")(function* (sessionID: string) {
  const afs = yield* AppFileSystem.Service
  const dir = backupDir(sessionID)

  const exists = yield* afs.existsSafe(dir)
  if (!exists) return [] as BackupEntry[]

  const entries = yield* afs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([] as string[])))
  const bakFiles = entries.filter((e) => e.endsWith(".bak"))

  return yield* Effect.forEach(
    bakFiles,
    Effect.fnUntraced(function* (filename: string) {
      const match = filename.match(/^(\d{8}-\d{6})_/)
      const timestamp = match?.[1] ?? ""

      let originalPath: string | undefined
      const metaPath = path.join(dir, filename + ".meta.json")
      yield* afs
        .readFileString(metaPath)
        .pipe(
          Effect.map((text) => {
            const meta = JSON.parse(text) as { originalPath: string }
            originalPath = meta.originalPath
          }),
          Effect.catch(() => Effect.void),
        )

      return { filename, timestamp, originalPath }
    }),
  )
})

export const restoreBackup = Effect.fn("EditBackup.restore")(
  function* (sessionID: string, filename: string) {
    const afs = yield* AppFileSystem.Service
    const dir = backupDir(sessionID)
    const bakPath = path.join(dir, filename)

    const metaPath = bakPath + ".meta.json"
    let originalPath = yield* afs
      .readFileString(metaPath)
      .pipe(
        Effect.map((text) => (JSON.parse(text) as { originalPath: string }).originalPath),
        Effect.catch(() =>
          Effect.die(new Error(`No meta.json found for ${filename}; cannot determine original file path`)),
        ),
      )

    const content = yield* afs.readFileString(bakPath)
    yield* afs.writeWithDirs(originalPath, content)

    return originalPath
  },
)
