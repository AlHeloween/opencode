import { spawnSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

export function fossilSidecar(root: string): string {
  if (process.env.FOSSIL_REPOSITORY) return path.resolve(process.env.FOSSIL_REPOSITORY)
  const fossilRoot = path.join(root, ".opencode", "data", "fossil")
  if (!existsSync(fossilRoot)) {
    throw new Error(`No Fossil sidecar root at ${fossilRoot}. Set FOSSIL_REPOSITORY explicitly.`)
  }
  const repositories = readdirSync(fossilRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(fossilRoot, entry.name, "snapshot.fsl"))
    .filter(existsSync)
  if (repositories.length !== 1) {
    throw new Error(`Expected exactly one Fossil sidecar under ${fossilRoot}; set FOSSIL_REPOSITORY explicitly.`)
  }
  return repositories[0]!
}

export function fossilBinary(root: string): string {
  if (process.env.FOSSIL_BIN) return process.env.FOSSIL_BIN
  const bundled = path.join(root, "external", "fossil", process.platform === "win32" ? "fossil.exe" : "fossil")
  return existsSync(bundled) ? bundled : "fossil"
}

export function fossilSidecarCommand(root: string, args: string[]) {
  const [command, ...rest] = args
  if (!command) throw new Error("Fossil command is required")
  const result = spawnSync(fossilBinary(root), [command, "-R", fossilSidecar(root), ...rest], {
    cwd: root,
    encoding: "utf-8",
    timeout: 60_000,
    windowsHide: true,
  })
  return {
    code: result.status ?? 1,
    text: result.stdout.toString(),
    error: result.stderr.toString(),
  }
}

export function fossilRange(root: string, args: string[]): { from: string; to: string } {
  if (args.length >= 2) return { from: args[0]!, to: args[1]! }
  const timeline = fossilSidecarCommand(root, ["timeline", "-n", "5", "--type", "ci"])
  if (timeline.code !== 0) throw new Error(`fossil timeline failed: ${timeline.error || timeline.text}`)
  const hashes = timeline.text
    .split("\n")
    .map((line) => line.match(/\[([a-f0-9]{8,40})\]/i)?.[1])
    .filter((hash): hash is string => Boolean(hash))
  if (hashes.length < 2) throw new Error(`Need two Fossil snapshots; found ${hashes.length}`)
  return { from: hashes[1]!, to: hashes[0]! }
}
