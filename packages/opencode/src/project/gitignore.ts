import { Effect } from "effect"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

const runtimeDataIgnore = ".opencode/data"
const tempIgnore = ".temp"
const codeGraphDir = ".codegraph"
const configFileName = "config.json"
const configIgnore = `/${configFileName}`
const defaultIgnores = [runtimeDataIgnore, tempIgnore, codeGraphDir, configIgnore]

function hasIgnore(text: string, value: string) {
  const normalized = value.replace(/^\//, "")
  const accepted = new Set([value, `${value}/`, normalized, `${normalized}/`, `/${normalized}`, `/${normalized}/`])
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => !line.startsWith("#") && accepted.has(line))
}

export function isRuntimeDataPath(file: string) {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "")
  return (
    normalized === runtimeDataIgnore ||
    normalized.startsWith(`${runtimeDataIgnore}/`) ||
    normalized === tempIgnore ||
    normalized.startsWith(`${tempIgnore}/`) ||
    normalized === codeGraphDir ||
    normalized.startsWith(`${codeGraphDir}/`) ||
    normalized === configFileName
  )
}

export const ensureRuntimeDataIgnored = Effect.fn("ProjectGitignore.ensureRuntimeDataIgnored")(function* (
  fs: AppFileSystem.Interface,
  worktree: string,
) {
  const file = path.join(worktree, ".gitignore")
  const text = yield* fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed("")))
  const linesToAdd = defaultIgnores.filter((value) => !hasIgnore(text, value))
  if (linesToAdd.length === 0) return

  yield* fs
    .writeFileString(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${linesToAdd.join("\n")}\n`)
    .pipe(Effect.orDie)
})
