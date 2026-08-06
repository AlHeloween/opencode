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

export const checkFileConflicts = Effect.fn("EditBackup.checkConflicts")(
  function* (sessionID: string, affectedFiles: string[]) {
    const afs = yield* AppFileSystem.Service
    const dir = backupDir(sessionID)

    const exists = yield* afs.existsSafe(dir)
    if (!exists) return [] as { file: string; bakFile: string }[]

    const entries = yield* afs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([] as string[])))
    const bakFiles = entries.filter((e) => e.endsWith(".bak"))

    // Build map: originalPath -> latest .bak file (sorted by name = timestamp)
    const bakMap = new Map<string, string>()
    for (const filename of bakFiles.sort()) {
      const metaPath = path.join(dir, filename + ".meta.json")
      yield* afs
        .readFileString(metaPath)
        .pipe(
          Effect.map((text) => {
            const meta = JSON.parse(text) as { originalPath: string }
            if (meta.originalPath) bakMap.set(meta.originalPath, filename)
          }),
          Effect.catch(() => Effect.void),
        )
    }

    // Check each affected file against its latest .bak
    const conflicts: { file: string; bakFile: string }[] = []
    for (const file of affectedFiles) {
      const bakFile = bakMap.get(file)
      if (!bakFile) continue

      const currentContent = yield* afs
        .readFileString(file)
        .pipe(Effect.catch(() => Effect.succeed(null)))
      if (currentContent === null) continue

      const bakContent = yield* afs
        .readFileString(path.join(dir, bakFile))
        .pipe(Effect.catch(() => Effect.succeed(null)))
      if (bakContent === null) continue

      // Normalize line endings for comparison
      if (currentContent.replaceAll("\r\n", "\n") !== bakContent.replaceAll("\r\n", "\n")) {
        conflicts.push({ file, bakFile })
      }
    }

    return conflicts
  },
)

export const restoreBackup = Effect.fn("EditBackup.restore")(
  function* (sessionID: string, filename: string) {
    const afs = yield* AppFileSystem.Service
    const dir = backupDir(sessionID)
    const bakPath = path.join(dir, filename)

    const metaPath = bakPath + ".meta.json"
    const originalPath = yield* afs
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

/** Normalize paths for matching originalPath (Windows drive + separators). */
export function pathsMatch(a: string, b: string): boolean {
  const norm = (p: string) => {
    try {
      return path.resolve(p).replaceAll("\\", "/").toLowerCase()
    } catch {
      return p.replaceAll("\\", "/").toLowerCase()
    }
  }
  return norm(a) === norm(b)
}

/**
 * Latest session .bak for a file path (by filename timestamp order).
 * Matches meta.originalPath against absolute or relative filePath.
 */
export const findLatestBackup = Effect.fn("EditBackup.findLatest")(function* (
  sessionID: string,
  filePath: string,
  resolveRelative?: (p: string) => string,
) {
  const entries = yield* listBackups(sessionID)
  const candidates = entries
    .filter((e) => e.originalPath && pathsMatch(e.originalPath, filePath))
    .toSorted((a, b) => b.timestamp.localeCompare(a.timestamp) || b.filename.localeCompare(a.filename))
  if (candidates.length > 0) return candidates[0]

  // Retry with resolved absolute (agent may pass relative under cwd)
  if (resolveRelative && !path.isAbsolute(filePath)) {
    const abs = resolveRelative(filePath)
    const again = entries
      .filter((e) => e.originalPath && pathsMatch(e.originalPath, abs))
      .toSorted((a, b) => b.timestamp.localeCompare(a.timestamp) || b.filename.localeCompare(a.filename))
    if (again.length > 0) return again[0]
  }
  return undefined
})
