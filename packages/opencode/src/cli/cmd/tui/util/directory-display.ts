function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "")
}

function pathKey(value: string) {
  const normalized = normalizePath(value)
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

function basename(value: string) {
  return normalizePath(value).split("/").filter(Boolean).at(-1) ?? value
}

/** Case-insensitive equality on normalized absolute paths (win32 drives differ
 * only by case; separators and trailing slashes are normalized first). */
export function isSameDirectory(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false
  return pathKey(a) === pathKey(b)
}

export function formatProjectDirectory(input: { directory: string; worktree: string; branch?: string }) {
  const directory = normalizePath(input.directory)
  const worktree = normalizePath(input.worktree)
  const worktreeName = basename(worktree)
  const directoryKey = pathKey(directory)
  const worktreeKey = pathKey(worktree)
  const text =
    worktree && directoryKey === worktreeKey
      ? `~/${worktreeName}`
      : worktree && directoryKey.startsWith(worktreeKey + "/")
        ? `~/${worktreeName}/${directory.slice(worktree.length + 1)}`
        : directory

  if (input.branch) return text + ":" + input.branch
  return text
}
