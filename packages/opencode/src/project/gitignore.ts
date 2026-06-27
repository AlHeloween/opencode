import { Effect } from "effect"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

const runtimeDataIgnore = ".opencode/data"
const tempIgnore = ".temp"
const acceptedRuntimeDataIgnores = new Set([
  runtimeDataIgnore,
  `${runtimeDataIgnore}/`,
  `/${runtimeDataIgnore}`,
  `/${runtimeDataIgnore}/`,
  tempIgnore,
  `${tempIgnore}/`,
  `/${tempIgnore}`,
  `/${tempIgnore}/`,
])

function hasRuntimeDataIgnore(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => !line.startsWith("#") && acceptedRuntimeDataIgnores.has(line))
}

export function isRuntimeDataPath(file: string) {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "")
  return (
    normalized === runtimeDataIgnore ||
    normalized.startsWith(`${runtimeDataIgnore}/`) ||
    normalized === tempIgnore ||
    normalized.startsWith(`${tempIgnore}/`)
  )
}

export const ensureRuntimeDataIgnored = Effect.fn("ProjectGitignore.ensureRuntimeDataIgnored")(function* (
  fs: AppFileSystem.Interface,
  worktree: string,
) {
  const file = path.join(worktree, ".gitignore")
  const text = yield* fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed("")))
  if (hasRuntimeDataIgnore(text)) return

  // Add both .opencode/data and .temp if missing
  const linesToAdd = []
  if (!text.includes(".opencode/data")) linesToAdd.push(".opencode/data")
  if (!text.includes(".temp")) linesToAdd.push(".temp")
  if (linesToAdd.length === 0) return

  yield* fs
    .writeFileString(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${linesToAdd.join("\n")}\n`)
    .pipe(Effect.orDie)
})
