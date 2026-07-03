import { Duration, Effect, Layer, Schedule, Semaphore, Context, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { formatPatch, structuredPatch } from "diff"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Service as SnapshotService, type Interface, type Patch, type FileDiff } from "."

const log = Log.create({ service: "snapshot-jj" })
const FILE_SIZE_LIMIT = 2 * 1024 * 1024

type State = Omit<Interface, "init">

export const layer: Layer.Layer<
  SnapshotService,
  never,
  AppFileSystem.Service | ChildProcessSpawner.ChildProcessSpawner | Config.Service
> = Layer.effect(
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
      Effect.fn("SnapshotJj.state")(function* (ctx) {
        const jjDir = path.join(Global.Path.data, "jj", ctx.project.id)
        const worktree = ctx.worktree
        const locked = <A, E, R>(fx: Effect.Effect<A, E, R>) => lock(jjDir).withPermits(1)(fx)

        const enabled = Effect.fnUntraced(function* () {
          // jj works with or without git (native backend)
          return (yield* config.get()).snapshot !== false
        })

        const jj = Effect.fnUntraced(
          function* (args: string[], opts?: { cwd?: string; stdin?: ChildProcess.CommandInput }) {
            const proc = ChildProcess.make("jj", ["--no-pager", "--color", "never", ...args], {
              cwd: opts?.cwd ?? worktree,
              env: { JJ_CONFIG: path.join(jjDir, ".jj", "repo", "config.toml") },
              extendEnv: true,
              stdin: opts?.stdin,
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

        // Self-healing bootstrap: init jj repo if missing
        // Ensure .gitignore has VCS isolation patterns (prevent cross-tracking)
        const jjIgnorePatterns = [".jj", "**/.jj", ".jj/", "**/.jj/", ".git/", "**/.git/"]
        const ensureGitignore = Effect.fnUntraced(function* () {
          const gitignorePath = path.join(worktree, ".gitignore")
          const content = yield* fs.readFileString(gitignorePath).pipe(Effect.catch(() => Effect.succeed("")))
          const missing = jjIgnorePatterns.filter((p) => !content.includes(p))
          if (missing.length === 0) return
          log.info("adding jj isolation patterns to .gitignore", { missing })
          const separator = content && !content.endsWith("\n") ? "\n" : ""
          const block = `\n# VCS isolation (prevent cross-tracking)\n${missing.join("\n")}\n`
          yield* fs.writeFileString(gitignorePath, `${content}${separator}${block}`).pipe(Effect.orDie)
        })

        const ensureInit = Effect.fnUntraced(function* () {
          yield* ensureGitignore()

          const jjRepoDir = path.join(jjDir, ".jj")
          if (yield* fs.exists(jjRepoDir)) return

          log.info("initializing jj repo", { jjDir, worktree })
          yield* fs.ensureDir(jjDir).pipe(Effect.orDie)

          // Temporal displacement: init in temp dir, move .jj to target
          const tmpDir = path.join(Global.Path.data, "jj", `_init_${Date.now()}`)
          yield* fs.ensureDir(tmpDir).pipe(Effect.orDie)

          const initResult = yield* jj(["debug", "init-simple", tmpDir], { cwd: worktree })
          if (initResult.code !== 0) {
            log.warn("jj git init failed", { stderr: initResult.stderr })
            yield* fs.remove(tmpDir).pipe(Effect.catch(() => Effect.void))
            return
          }

          // Move .jj from temp to target (use rename, falls back to copy+delete)
          const tmpJj = path.join(tmpDir, ".jj")
          yield* fs.rename(tmpJj, jjRepoDir).pipe(
            Effect.catchTag("PlatformError", () =>
              Effect.gen(function* () {
                yield* fs.copy(tmpJj, jjRepoDir).pipe(Effect.orDie)
                yield* fs.remove(tmpDir).pipe(Effect.catch(() => Effect.void))
              }),
            ),
          )

          // Configure
          yield* jj(["config", "set", "--repo", "snapshot.auto-track", "none()"], { cwd: worktree })
          yield* jj(["config", "set", "--repo", "ui.color", "never"], { cwd: worktree })
          yield* jj(["config", "set", "--repo", "ui.paginate", "never"], { cwd: worktree })
          yield* jj(["config", "set", "--repo", "user.name", "opencode"], { cwd: worktree })
          yield* jj(["config", "set", "--repo", "user.email", "agent@local"], { cwd: worktree })

          log.info("jj repo initialized", { jjDir })
        })

        // Stale lock detection for Windows
        const checkLock = Effect.fnUntraced(function* () {
          const lockFile = path.join(jjDir, ".jj", "working_copy", "working_copy.lock")
          if (!(yield* fs.exists(lockFile))) return
          const stat = yield* fs.stat(lockFile).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!stat) return
          const mtime = stat.mtime instanceof Date ? stat.mtime : undefined
          const age = Date.now() - (mtime?.getTime() ?? 0)
          if (age > 15_000) {
            log.warn("removing stale jj lock file", { lockFile, ageMs: age })
            yield* fs.remove(lockFile).pipe(Effect.catch(() => Effect.void))
            yield* jj(["workspace", "update-stale"], { cwd: worktree }).pipe(Effect.catch(() => Effect.void))
          }
        })

        const track = Effect.fnUntraced(function* (files?: string[]) {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* enabled())) return undefined
              yield* ensureInit()
              yield* checkLock()

              // Explicitly track new files before snapshotting
              if (files?.length) {
                const rels = files.map((f) => path.relative(worktree, f).replaceAll("\\", "/"))
                yield* jj(["file", ...rels], { cwd: worktree }).pipe(Effect.catch(() => Effect.void))
              }

              const before = yield* jj(["--ignore-working-copy", "log", "--no-graph", "-r", "@", "--template", "commit_id"], {
                cwd: worktree,
              })
              const beforeHash = before.text.trim()

              yield* jj(["status"], { cwd: worktree })

              const after = yield* jj(["--ignore-working-copy", "log", "--no-graph", "-r", "@", "--template", "commit_id"], {
                cwd: worktree,
              })
              const afterHash = after.text.trim()

              if (afterHash === beforeHash) {
                log.info("tracking (no changes)", { hash: afterHash })
                return afterHash
              }

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
              const result = yield* jj(["--ignore-working-copy", "op", "log", "--no-graph", "--limit", "1", "--template", "self.id()"], {
                cwd: worktree,
              })
              return result.code === 0 ? result.text.trim() : undefined
            }).pipe(Effect.orDie),
          )
        })

        const opRestore = Effect.fnUntraced(function* (targetOpId: string) {
          return yield* locked(
            Effect.gen(function* () {
              log.info("op restore", { opId: targetOpId })
              yield* ensureInit()
              yield* checkLock()
              const result = yield* jj(["op", "restore", targetOpId], { cwd: worktree })
              if (result.code === 0) return
              log.error("jj op restore failed", { opId: targetOpId, stderr: result.stderr })
            }).pipe(Effect.orDie),
          )
        })

        const patch = Effect.fnUntraced(function* (hash: string) {
          return yield* locked(
            Effect.gen(function* () {
              yield* ensureInit()

              const result = yield* jj(
                ["--ignore-working-copy", "diff", "--from", hash, "--to", "@", "--stat", "--no-pager"],
                { cwd: worktree },
              )
              const files = result.text
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                  const match = line.match(/^(.+?)[\s|]/)
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
              log.info("restore", { commit: snapshot })
              yield* ensureInit()
              yield* checkLock()

              const result = yield* jj(["restore", "--from", snapshot, "--into", "@"], { cwd: worktree })
              if (result.code === 0) return
              log.error("jj restore failed", { snapshot, stderr: result.stderr })
            }).pipe(Effect.orDie),
          )
        })

        const revert = Effect.fnUntraced(function* (patches: Patch[]) {
          return yield* locked(
            Effect.gen(function* () {
              yield* ensureInit()
              yield* checkLock()

              const seen = new Set<string>()
              for (const item of patches) {
                for (const file of item.files) {
                  if (seen.has(file)) continue
                  seen.add(file)
                  const rel = path.relative(worktree, file).replaceAll("\\", "/")
                  log.info("reverting", { file: rel, from: item.hash })
                  const result = yield* jj(["restore", "--from", item.hash, "--into", "@", "--", rel], { cwd: worktree })
                  if (result.code !== 0) {
                    log.info("file not in snapshot, attempting delete", { file: rel })
                    yield* fs.remove(file).pipe(Effect.catch(() => Effect.void))
                  }
                }
              }

              yield* jj(["new", "-m", "revert"], { cwd: worktree })
            }).pipe(Effect.orDie),
          )
        })

        const diff = Effect.fnUntraced(function* (hash: string) {
          return yield* locked(
            Effect.gen(function* () {
              yield* ensureInit()
              const result = yield* jj(["diff", "--from", hash, "--to", "@"], { cwd: worktree })
              return result.code === 0 ? result.text.trim() : ""
            }).pipe(Effect.orDie),
          )
        })

        const diffFull = Effect.fnUntraced(function* (from: string, to: string) {
          return yield* locked(
            Effect.gen(function* () {
              yield* ensureInit()

              const statusResult = yield* jj(
                ["--ignore-working-copy", "diff", "--from", from, "--to", to, "--stat", "--no-pager"],
                { cwd: worktree },
              )
              if (statusResult.code !== 0) return []

              const files = statusResult.text
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                  const match = line.match(/^(.+?)[\s|]/)
                  return match?.[1]?.trim() ?? ""
                })
                .filter(Boolean)

              const result: FileDiff[] = []
              for (const file of files) {
                const rel = path.join(worktree, file).replaceAll("\\", "/")
                const statLine = statusResult.text.split("\n").find((l) => l.includes(file)) ?? ""
                const numMatch = statLine.match(/(\d+)\s+insertion.*?(\d+)\s+deletion/)
                const additions = numMatch ? parseInt(numMatch[1]) : 0
                const deletions = numMatch ? parseInt(numMatch[2]) : 0

                result.push({
                  file: rel,
                  patch: "",
                  additions,
                  deletions,
                  status: "modified" as const,
                })
              }

              return result
            }).pipe(Effect.orDie),
          )
        })

        // Periodic cleanup: abandon old operations
        yield* Effect.gen(function* () {
          if (!(yield* enabled())) return
          yield* ensureInit()
          log.info("cleanup: abandoning operations older than 7 days")
          yield* jj(["op", "abandon", "--before", "7.days"], { cwd: worktree }).pipe(
            Effect.catch((err) => {
              log.warn("jj op abandon failed", { error: String(err) })
              return Effect.void
            }),
          )
          yield* jj(["util", "gc"], { cwd: worktree }).pipe(
            Effect.catch((err) => {
              log.warn("jj gc failed", { error: String(err) })
              return Effect.void
            }),
          )
        }).pipe(
          Effect.catchCause((cause) => {
            log.error("cleanup loop failed", { cause: String(cause) })
            return Effect.void
          }),
          Effect.repeat(Schedule.spaced(Duration.hours(1))),
          Effect.delay(Duration.minutes(5)),
          Effect.forkScoped,
        )

        // Eagerly init jj repo on first access (don't wait for track())
        yield* ensureInit().pipe(Effect.catch((err) => {
          log.warn("bug: jj eager init failed", { error: String(err) })
          return Effect.void
        }))

        return { cleanup: () => Effect.void, track, opId, opRestore, patch, restore, revert, diff, diffFull }
      }),
    )

    return SnapshotService.of({
      init: Effect.fn("SnapshotJj.init")(function* () {
        yield* InstanceState.get(state)
      }),
      cleanup: Effect.fn("SnapshotJj.cleanup")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.cleanup())
      }),
      track: Effect.fn("SnapshotJj.track")(function* (files?: string[]) {
        return yield* InstanceState.useEffect(state, (s) => s.track(files))
      }),
      opId: Effect.fn("SnapshotJj.opId")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.opId())
      }),
      opRestore: Effect.fn("SnapshotJj.opRestore")(function* (opId: string) {
        return yield* InstanceState.useEffect(state, (s) => s.opRestore(opId))
      }),
      patch: Effect.fn("SnapshotJj.patch")(function* (hash: string) {
        return yield* InstanceState.useEffect(state, (s) => s.patch(hash))
      }),
      restore: Effect.fn("SnapshotJj.restore")(function* (snapshot: string) {
        return yield* InstanceState.useEffect(state, (s) => s.restore(snapshot))
      }),
      revert: Effect.fn("SnapshotJj.revert")(function* (patches: Patch[]) {
        return yield* InstanceState.useEffect(state, (s) => s.revert(patches))
      }),
      diff: Effect.fn("SnapshotJj.diff")(function* (hash: string) {
        return yield* InstanceState.useEffect(state, (s) => s.diff(hash))
      }),
      diffFull: Effect.fn("SnapshotJj.diffFull")(function* (from: string, to: string) {
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

export * as SnapshotJj from "./jj"
