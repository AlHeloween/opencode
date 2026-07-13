import { Duration, Effect, Layer, Schedule, Semaphore, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Service as SnapshotService, type Interface, type Patch, type FileDiff } from "."

const log = Log.create({ service: "snapshot-fossil" })

// Find fossil binary: tools/ relative to executable, then PATH
function findFossil(): string {
  // 1. tools/ relative to executable (e.g. opencode.exe/tools/fossil.exe)
  const execDir = path.dirname(process.execPath)
  const toolsPath = path.join(execDir, "tools", "fossil.exe")
  if (require("fs").existsSync(toolsPath)) return toolsPath

  // 2. tools/ relative to worktree
  const worktreeTools = path.join(Global.Path.home, "tools", "fossil.exe")
  if (require("fs").existsSync(worktreeTools)) return worktreeTools

  // 3. Fallback: hope it's on PATH
  return "fossil"
}

const FOSSIL_BIN = findFossil()

type State = Omit<Interface, "init">

export const layer = Layer.effect(
  SnapshotService,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const config = yield* Config.Service
    const locks = new Map<string, Semaphore.Semaphore>()

    const lock = (key: string) => {
      const hit = locks.get(key)
      if (hit) return hit
      const next = Semaphore.makeUnsafe(1)
      locks.set(key, next)
      return next
    }

    const state = yield* InstanceState.make<State>(
      Effect.fn("SnapshotFossil.state")(function* (ctx) {
        const fossilDir = path.join(Global.Path.data, "fossil", ctx.project.id)
        const repoPath = path.join(fossilDir, "snapshot.fsl")
        const worktree = ctx.worktree
        const locked = <A, E, R>(fx: Effect.Effect<A, E, R>) => lock(fossilDir).withPermits(1)(fx)

        const enabled = Effect.fnUntraced(function* () {
          return (yield* config.get()).snapshot !== false
        })

        const fossil = Effect.fnUntraced(
          function* (args: string[], opts?: { cwd?: string }) {
            const proc = ChildProcess.make(FOSSIL_BIN, args, {
              cwd: opts?.cwd ?? worktree,
              extendEnv: true,
            })
            const handle = yield* spawner.spawn(proc)
            const [text, stderr] = yield* Effect.all(
              [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
              { concurrency: 2 },
            )
            const code = yield* handle.exitCode
            return { code, text, stderr }
          },
          Effect.scoped,
          Effect.catch((err) =>
            Effect.succeed({
              code: 1 as any,
              text: "",
              stderr: err instanceof Error ? err.message : String(err),
            }),
          ),
        )

        // Translate .gitignore patterns to Fossil ignore-glob format
        const translateGitignore = Effect.fnUntraced(function* () {
          const gitignorePath = path.join(worktree, ".gitignore")
          const content = yield* fs.readFileString(gitignorePath).pipe(Effect.catch(() => Effect.succeed("")))
          if (!content) return ""

          const lines = content.split(/\r?\n/).filter((l) => {
            const trimmed = l.trim()
            return trimmed && !trimmed.startsWith("#")
          })

          const translated: string[] = []
          for (const line of lines) {
            let p = line.trim()
            // Skip negation patterns (not supported in Fossil)
            if (p.startsWith("!")) continue
            // Remove leading / (Fossil patterns are always root-relative)
            if (p.startsWith("/")) p = p.slice(1)
            // Remove trailing / (Fossil has no directory-only distinction)
            if (p.endsWith("/")) p = p.slice(0, -1)
            // Replace **/ with nothing (* already matches / in Fossil)
            p = p.replace(/^\*\*\//, "").replace(/\/\*\*$/, "").replace(/\/\*\*\//, "/*/")
            // Replace remaining ** with *
            p = p.replace(/\*\*/g, "*")
            // Skip empty patterns
            if (!p || p === ".") continue
            translated.push(p)
          }

          return translated.join("\n")
        })

        // Ensure .fossil-settings/ignore-glob exists and is synced from .gitignore
        const ensureIgnoreGlob = Effect.fnUntraced(function* () {
          const settingsDir = path.join(worktree, ".fossil-settings")
          const ignorePath = path.join(settingsDir, "ignore-glob")

          const gitignorePatterns = yield* translateGitignore()
          // Add our own patterns
          const extraPatterns = ["*.fsl", ".jj", ".git", "_FOSSIL_", "_fossil"]
          const allPatterns = [...extraPatterns, ...gitignorePatterns.split("\n").filter(Boolean)]

          const existing = yield* fs.readFileString(ignorePath).pipe(Effect.catch(() => Effect.succeed("")))
          const content = allPatterns.join("\n") + "\n"

          if (existing === content) return

          log.info("syncing ignore-glob from .gitignore", { patterns: allPatterns.length })
          yield* fs.ensureDir(settingsDir).pipe(Effect.orDie)
          yield* fs.writeFileString(ignorePath, content).pipe(Effect.orDie)
        })

        // Self-healing bootstrap — if fossil open fails (corrupted DB), remove and reinit
        const ensureInit = Effect.fnUntraced(function* () {
          yield* ensureIgnoreGlob()

          if (yield* fs.exists(repoPath)) {
            const openResult = yield* fossil(["open", repoPath, "--keep"], { cwd: worktree }).pipe(
              Effect.catch(() => Effect.succeed({ code: -1, text: "", stderr: "fossil process error" })),
            )
            if (openResult.code === 0) return

            // Corrupted or out-of-sync database — atomic recovery scoped to this checkout/repo pair
            log.warn("fossil open failed, performing atomic recovery", { stderr: openResult.stderr })

            // Close stale checkout database (may point to a deleted or mismatched repo)
            yield* fossil(["close", "--force"], { cwd: worktree }).pipe(Effect.catch(() => Effect.void))

            // Remove corrupted repo file
            yield* fs.remove(repoPath).pipe(Effect.catch(() => Effect.void))

            // Remove stale checkout DB and ignore-glob for clean reinit
            yield* fs.remove(path.join(worktree, "_FOSSIL_")).pipe(Effect.catch(() => Effect.void))
            yield* fs.remove(path.join(worktree, ".fossil-settings", "ignore-glob")).pipe(Effect.catch(() => Effect.void))

            return
          }

          log.info("initializing fossil repo", { repoPath, worktree })
          yield* fs.ensureDir(fossilDir).pipe(Effect.orDie)

          const initResult = yield* fossil(["init", repoPath], { cwd: worktree })
          if (initResult.code !== 0) {
            log.warn("fossil init failed", { stderr: initResult.stderr })
            return
          }

          const openResult = yield* fossil(["open", repoPath, "--keep"], { cwd: worktree })
          if (openResult.code !== 0) {
            log.warn("fossil open failed", { stderr: openResult.stderr })
            return
          }

          // Initial empty commit
          yield* fossil(["commit", "-m", "opencode-init", "--no-warnings", "--allow-fork"], { cwd: worktree }).pipe(
            Effect.catch(() => Effect.void),
          )

          log.info("fossil repo initialized", { repoPath })
        })

        const track = Effect.fnUntraced(function* (files?: string[]) {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* enabled())) return undefined
              yield* ensureInit()

              // Ensure changed files are tracked before commit
              if (files?.length) {
                for (const file of files) {
                  const rel = path.relative(worktree, file).replaceAll("\\", "/")
                  yield* fossil(["add", rel], { cwd: worktree }).pipe(
                    Effect.catch(() => Effect.void),
                  )
                }
              }

              // Handle missing tracked files — remove them from tracking so
              // they don't block the commit (fossil requires all tracked files
              // to exist on disk before committing).
              const missingResult = yield* fossil(["changes", "--missing"], { cwd: worktree }).pipe(
                Effect.catch(() => Effect.succeed({ code: 1, text: "", stderr: "" })),
              )
              if (missingResult.code === 0 && missingResult.text.trim()) {
                for (const line of missingResult.text.trim().split("\n")) {
                  const file = line.replace(/^MISSING\s+/, "").trim()
                  if (file) {
                    yield* fossil(["rm", file], { cwd: worktree }).pipe(
                      Effect.catch(() => Effect.void),
                    )
                  }
                }
              }

              // Get current version before commit
              const before = yield* fossil(["info", "current"], { cwd: worktree })
              const beforeHash = before.text.match(/hash:\s+([a-f0-9]+)/)?.[1]?.trim() ?? ""

              // Use --allow-fork: when autosync is enabled (Fossil default),
              // commits that would create a fork are rejected unless --allow-fork
              // is passed. Since this is a snapshot system where fork topology
              // doesn't matter, always allow forking.
              const commitResult = yield* fossil(["commit", "-m", "auto-snapshot", "--no-warnings", "--allow-fork"], {
                cwd: worktree,
              })

              if (commitResult.code !== 0) {
                log.info("tracking commit failed", { hash: beforeHash, stderr: commitResult.stderr })
                return beforeHash
              }

              // Parse new version from output
              const afterHash = commitResult.text.match(/New_Version:\s+([a-f0-9]+)/)?.[1]?.trim()
                ?? commitResult.text.trim()

              log.info("tracking", { hash: afterHash, before: beforeHash })
              return afterHash
            }).pipe(Effect.orDie),
          )
        })

        const opId = Effect.fnUntraced(function* () {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* enabled())) return undefined
              yield* ensureInit()
              // Fossil doesn't have a separate op log — use version hash as op ID
              const result = yield* fossil(["info", "current"], { cwd: worktree })
              const hash = result.text.match(/hash:\s+([a-f0-9]+)/)?.[1]?.trim()
              return result.code === 0 ? hash : undefined
            }).pipe(Effect.orDie),
          )
        })

        const opRestore = Effect.fnUntraced(function* (targetVersion: string) {
          return yield* locked(
            Effect.gen(function* () {
              log.info("fossil checkout (opRestore)", { version: targetVersion })
              yield* ensureInit()
              const result = yield* fossil(["checkout", targetVersion], { cwd: worktree })
              if (result.code === 0) return
              log.error("fossil checkout failed", { version: targetVersion, stderr: result.stderr })
            }).pipe(Effect.orDie),
          )
        })

        const patch = Effect.fnUntraced(function* (hash: string) {
          return yield* locked(
            Effect.gen(function* () {
              yield* ensureInit()
              const result = yield* fossil(["diff", "--from", hash, "--brief"], {
                cwd: worktree,
              })
              const files = result.text
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                  // "CHANGED file.txt" or "ADDED file.txt" format
                  const match = line.match(/^[A-Z]+\s+(.+)$/)
                  return match?.[1]?.trim() ?? ""
                })
                .filter(Boolean)
                .map((f) => path.join(worktree, f).replaceAll("\\", "/"))

              return { hash, files }
            }).pipe(Effect.orDie),
          )
        })

        const restore = Effect.fnUntraced(function* (snapshot: string) {
          return yield* locked(
            Effect.gen(function* () {
              log.info("restore (checkout)", { version: snapshot })
              yield* ensureInit()
              const result = yield* fossil(["checkout", snapshot], { cwd: worktree })
              if (result.code === 0) return
              log.error("fossil checkout failed", { snapshot, stderr: result.stderr })
            }).pipe(Effect.orDie),
          )
        })

        const revert = Effect.fnUntraced(function* (patches: Patch[]) {
          return yield* locked(
            Effect.gen(function* () {
              yield* ensureInit()

              const seen = new Set<string>()
              for (const item of patches) {
                for (const file of item.files) {
                  if (seen.has(file)) continue
                  seen.add(file)
                  const rel = path.relative(worktree, file).replaceAll("\\", "/")
                  const resolvedHash = yield* resolveHash(item.hash)
                  log.info("reverting", { file: rel, from: resolvedHash })
                  const result = yield* fossil(["revert", rel, "-r", resolvedHash], { cwd: worktree })
                  if (result.code !== 0) {
                    log.info("file not in snapshot, attempting delete", { file: rel })
                    yield* fs.remove(file).pipe(Effect.catch(() => Effect.void))
                  }
                }
              }

              // Seal the revert
              yield* fossil(["commit", "-m", "revert", "--no-warnings", "--allow-fork"], { cwd: worktree }).pipe(
                Effect.catch(() => Effect.void),
              )
            }).pipe(Effect.orDie),
          )
        })

        const diff = Effect.fnUntraced(function* (hash: string) {
          return yield* locked(
            Effect.gen(function* () {
              yield* ensureInit()
              const resolved = yield* resolveHash(hash)
              const result = yield* fossil(["diff", "--from", resolved], { cwd: worktree })
              return result.code === 0 ? result.text.trim() : ""
            }).pipe(Effect.orDie),
          )
        })

        const getEarliestCommit = Effect.fnUntraced(function* () {
          // fossil uses "timeline" not "log"; --reverse with limit 1 gives earliest commit
          const result = yield* fossil(
            ["timeline", "--limit", "1", "--format", "%H", "--reverse"],
            { cwd: worktree },
          )
          if (result.code !== 0) return undefined
          const hash = result.text.trim().split("\n")[0]?.trim()
          // fossil may return 64-char SHA3-256 or 40-char; either works with fossil commands
          return hash?.slice(0, 40) || undefined
        })

        const resolveHash = Effect.fnUntraced(function* (hash: string) {
          // Check if hash exists in fossil repo
          const check = yield* fossil(["info", hash], { cwd: worktree })
          if (check.code === 0) return hash
          // Hash not found (e.g. old git hash) — fallback to earliest fossil commit
          const earliest = yield* getEarliestCommit()
          log.warn("hash not found in fossil, using earliest", { hash, fallback: earliest })
          return earliest ?? hash
        })

        const diffFull = Effect.fnUntraced(function* (from: string, to: string) {
          return yield* locked(
            Effect.gen(function* () {
              yield* ensureInit()

              // Resolve hashes — fallback for old git hashes
              const resolvedFrom = yield* resolveHash(from)
              const resolvedTo = yield* resolveHash(to)

              // Get numstat (insertions/deletions per file)
              const statusResult = yield* fossil(["diff", "--from", resolvedFrom, "--to", resolvedTo, "-s"], {
                cwd: worktree,
              })
              if (statusResult.code !== 0) return []

              // Get brief status (ADDED/DELETED/EDITED/CHANGED per file)
              const briefResult = yield* fossil(["diff", "--from", resolvedFrom, "--to", resolvedTo, "--brief"], {
                cwd: worktree,
              })
              const statusMap = new Map<string, "added" | "deleted" | "modified">()
              if (briefResult.code === 0) {
                for (const line of briefResult.text.trim().split("\n").filter(Boolean)) {
                  const match = line.match(/^(ADDED|DELETED|EDITED|CHANGED|UPDATE)\s+(.+)$/)
                  if (match) {
                    const status = match[1]
                    const file = match[2].trim()
                    statusMap.set(file, status === "ADDED" ? "added" : status === "DELETED" ? "deleted" : "modified")
                  }
                }
              }

              const files = statusResult.text
                .trim()
                .split("\n")
                .filter(Boolean)
                .filter((line) => !line.includes("TOTAL") && !line.includes("INSERTED"))
                .map((line) => {
                  const parts = line.trim().split(/\s+/)
                  return parts.length >= 3 ? parts[2] : ""
                })
                .filter(Boolean)

              const result: FileDiff[] = []
              for (const file of files) {
                const rel = path.join(worktree, file).replaceAll("\\", "/")
                const statLine = statusResult.text.split("\n").find((l) => l.includes(file)) ?? ""
                const parts = statLine.trim().split(/\s+/)
                const additions = parts.length >= 2 ? parseInt(parts[0]) || 0 : 0
                const deletions = parts.length >= 3 ? parseInt(parts[1]) || 0 : 0

                result.push({
                  file: rel,
                  patch: "",
                  additions,
                  deletions,
                  status: statusMap.get(file) ?? "modified",
                })
              }

              return result
            }).pipe(Effect.orDie),
          )
        })

        // Eagerly init
        yield* ensureInit().pipe(
          Effect.catch((err) => {
            log.warn("bug: fossil eager init failed", { error: String(err) })
            return Effect.void
          }),
        )

        return { cleanup: () => Effect.void, track, opId, opRestore, patch, restore, revert, diff, diffFull }
      }),
    )

    return SnapshotService.of({
      init: Effect.fn("SnapshotFossil.init")(function* () {
        yield* InstanceState.get(state)
      }),
      cleanup: Effect.fn("SnapshotFossil.cleanup")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.cleanup())
      }),
      track: Effect.fn("SnapshotFossil.track")(function* (files?: string[]) {
        return yield* InstanceState.useEffect(state, (s) => s.track(files))
      }),
      opId: Effect.fn("SnapshotFossil.opId")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.opId())
      }),
      opRestore: Effect.fn("SnapshotFossil.opRestore")(function* (opId: string) {
        return yield* InstanceState.useEffect(state, (s) => s.opRestore(opId))
      }),
      patch: Effect.fn("SnapshotFossil.patch")(function* (hash: string) {
        return yield* InstanceState.useEffect(state, (s) => s.patch(hash))
      }),
      restore: Effect.fn("SnapshotFossil.restore")(function* (snapshot: string) {
        return yield* InstanceState.useEffect(state, (s) => s.restore(snapshot))
      }),
      revert: Effect.fn("SnapshotFossil.revert")(function* (patches: Patch[]) {
        return yield* InstanceState.useEffect(state, (s) => s.revert(patches))
      }),
      diff: Effect.fn("SnapshotFossil.diff")(function* (hash: string) {
        return yield* InstanceState.useEffect(state, (s) => s.diff(hash))
      }),
      diffFull: Effect.fn("SnapshotFossil.diffFull")(function* (from: string, to: string) {
        return yield* InstanceState.useEffect(state, (s) => s.diffFull(from, to))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

export * as SnapshotFossil from "./fossil"
