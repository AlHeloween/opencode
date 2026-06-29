import { Duration, Effect, Layer, Schedule, Schema, Semaphore, Context, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { createPatch } from "@/util/diff-wasm"
import path from "path"
import z from "zod"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Hash } from "@opencode-ai/core/util/hash"
import { Config } from "@/config/config"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { withStatics } from "@/util/schema"
import { zod } from "@/util/effect-zod"

export const Patch = Schema.Struct({
  hash: Schema.String,
  files: Schema.mutable(Schema.Array(Schema.String)),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Patch = typeof Patch.Type

export const FileDiff = Schema.Struct({
  file: Schema.String,
  patch: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
})
  .annotate({ identifier: "SnapshotFileDiff" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type FileDiff = typeof FileDiff.Type

const log = Log.create({ service: "snapshot" })
const prune = "7.days"
const JJ_BIN = path.join(Global.Path.home, "tools", "jj.exe")

interface JjResult {
  readonly code: ChildProcessSpawner.ExitCode
  readonly text: string
  readonly stderr: string
}

type State = Omit<Interface, "init">

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly cleanup: () => Effect.Effect<void>
  readonly track: () => Effect.Effect<string | undefined>
  readonly patch: (hash: string) => Effect.Effect<Patch>
  readonly restore: (snapshot: string) => Effect.Effect<void>
  readonly revert: (patches: Patch[]) => Effect.Effect<void>
  readonly diff: (hash: string) => Effect.Effect<string>
  readonly diffFull: (from: string, to: string) => Effect.Effect<FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Snapshot") {}

export const layer: Layer.Layer<
  Service,
  never,
  AppFileSystem.Service | ChildProcessSpawner.ChildProcessSpawner | Config.Service
> = Layer.effect(
  Service,
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
      Effect.fn("Snapshot.state")(function* (ctx) {
        const state = {
          directory: ctx.directory,
          worktree: ctx.worktree,
          jjdir: path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(ctx.worktree)),
          vcs: ctx.project.vcs,
        }

        const jj = Effect.fnUntraced(
          function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
            const proc = ChildProcess.make(JJ_BIN, cmd, {
              cwd: opts?.cwd ?? state.worktree,
              env: { ...opts?.env, JJ_CONFIG: path.join(state.jjdir, "config.toml") },
              extendEnv: true,
            })
            const handle = yield* spawner.spawn(proc)
            const [text, stderr] = yield* Effect.all(
              [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
              { concurrency: 2 },
            )
            const code = yield* handle.exitCode
            return { code, text, stderr } satisfies JjResult
          },
          Effect.scoped,
          Effect.catch((err) =>
            Effect.succeed({
              code: ChildProcessSpawner.ExitCode(1),
              text: "",
              stderr: err instanceof Error ? err.message : String(err),
            }),
          ),
        )

        const exists = (file: string) => fs.exists(file).pipe(Effect.orDie)
        const remove = (file: string) => fs.remove(file).pipe(Effect.catch(() => Effect.void))
        const locked = <A, E, R>(fx: Effect.Effect<A, E, R>) => lock(state.jjdir).withPermits(1)(fx)

        const enabled = Effect.fnUntraced(function* () {
          if (state.vcs !== "git") return false
          return (yield* config.get()).snapshot !== false
        })

        // ── jj: init repo ────────────────────────────────────────────────────
        const ensureInit = Effect.fnUntraced(function* () {
          const jjRepo = path.join(state.worktree, ".jj", "repo")
          if (yield* exists(jjRepo)) return
          yield* fs.ensureDir(state.jjdir).pipe(Effect.orDie)
          // Write minimal jj config
          yield* fs.writeFileString(
            path.join(state.jjdir, "config.toml"),
            `[user]\nname = "opencode"\nemail = "opencode@local"\n`,
          ).pipe(Effect.orDie)
          yield* jj(["git", "init"])
          log.info("jj repo initialized", { worktree: state.worktree })
        })

        // ── track: snapshot working copy ─────────────────────────────────────
        const track = Effect.fnUntraced(function* () {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* enabled())) return
              yield* ensureInit()
              // jj new forks WC, auto-committing parent as snapshot
              const r = yield* jj(["new", "-m", "snapshot"])
              if (r.code !== 0) return
              // Parent (@-) is the committed snapshot
              const logResult = yield* jj(["log", "-r", "@-", "--no-graph", "-T", "change_id"])
              const hash = logResult.text.trim()
              log.info("tracked", { hash: hash.slice(0, 12), worktree: state.worktree })
              return hash || undefined
            }),
          )
        })

        // ── patch: diff name-only from snapshot ──────────────────────────────
        const patch = Effect.fnUntraced(function* (hash: string) {
          return yield* locked(
            Effect.gen(function* () {
              const r = yield* jj(["diff", "--summary", "--from", hash])
              if (r.code !== 0) return { hash, files: [] as string[] }
              const files = r.text
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((l) => l.slice(2).trim()) // strip "A "/"M "/"D " prefix
                .filter(Boolean)
              return {
                hash,
                files: files.map((f) => path.join(state.worktree, f).replaceAll("\\", "/")),
              }
            }),
          )
        })

        // ── restore: revert all files to snapshot ────────────────────────────
        const restore = Effect.fnUntraced(function* (snapshot: string) {
          return yield* locked(
            Effect.gen(function* () {
              log.info("restore", { snapshot: snapshot.slice(0, 12) })
              const r = yield* jj(["restore", "--from", snapshot])
              if (r.code !== 0) {
                log.error("failed to restore snapshot", { snapshot: snapshot.slice(0, 12), stderr: r.stderr })
              }
            }),
          )
        })

        // ── revert: restore specific files to snapshot state ─────────────────
        const revert = Effect.fnUntraced(function* (patches: Patch[]) {
          return yield* locked(
            Effect.gen(function* () {
              const ops: { hash: string; file: string; rel: string }[] = []
              const seen = new Set<string>()
              for (const item of patches) {
                for (const file of item.files) {
                  if (seen.has(file)) continue
                  seen.add(file)
                  ops.push({
                    hash: item.hash,
                    file,
                    rel: path.relative(state.worktree, file).replaceAll("\\", "/"),
                  })
                }
              }

              // jj restore handles multiple files in one call
              for (const op of ops) {
                log.info("reverting", { file: op.file, hash: op.hash.slice(0, 12) })
                const r = yield* jj(["restore", "--from", op.hash, op.file])
                if (r.code !== 0) {
                  // File might not exist in snapshot — check and delete
                  const list = yield* jj(["file", "list", "-r", op.hash])
                  if (!list.text.includes(op.rel)) {
                    log.info("file not in snapshot, deleting", { file: op.file })
                    yield* remove(op.file)
                  }
                }
              }
            }),
          )
        })

        // ── diff: git-style unified diff from snapshot ───────────────────────
        const diff = Effect.fnUntraced(function* (hash: string) {
          return yield* locked(
            Effect.gen(function* () {
              const r = yield* jj(["diff", "--git", "--from", hash])
              if (r.code !== 0) {
                log.warn("failed to get diff", { hash: hash.slice(0, 12), stderr: r.stderr })
                return ""
              }
              return r.text.trim()
            }),
          )
        })

        // ── diffFull: full file-level diff with content ──────────────────────
        const diffFull = Effect.fnUntraced(function* (from: string, to: string) {
          return yield* locked(
            Effect.gen(function* () {
              type Row = {
                file: string
                status: "added" | "deleted" | "modified"
                additions: number
                deletions: number
              }

              // Get file-level changes via --summary
              const summary = yield* jj(["diff", "--summary", "--from", from, "--to", to])
              if (summary.code !== 0) return [] as FileDiff[]

              const rows: Row[] = []
              for (const line of summary.text.trim().split("\n")) {
                if (!line) continue
                const code = line[0]
                const file = line.slice(2).trim()
                if (!file) continue
                rows.push({
                  file,
                  status: code === "A" ? "added" : code === "D" ? "deleted" : "modified",
                  additions: 0,
                  deletions: 0,
                })
              }

              // Get numstat via --stat (parse human-readable)
              const stat = yield* jj(["diff", "--stat", "--from", from, "--to", to])
              if (stat.code === 0) {
                for (const line of stat.text.trim().split("\n")) {
                  const m = line.match(/^(.+?)\s+\|\s+(\d+)\s+(\+*)(-*)$/)
                  if (!m) continue
                  const file = m[1].trim()
                  const row = rows.find((r) => r.file === file)
                  if (row) {
                    row.additions = m[3].length
                    row.deletions = m[4].length
                  }
                }
              }

              const result: FileDiff[] = []
              for (const row of rows) {
                let before = ""
                let after = ""
                if (row.status !== "added") {
                  const fb = yield* jj(["file", "show", "-r", from, row.file])
                  if (fb.code === 0) before = fb.text
                }
                if (row.status !== "deleted") {
                  const fa = yield* jj(["file", "show", "-r", to, row.file])
                  if (fa.code === 0) after = fa.text
                }
                result.push({
                  file: row.file,
                  patch: createPatch(before, after) ?? "",
                  additions: row.additions,
                  deletions: row.deletions,
                  status: row.status,
                })
              }

              return result
            }),
          )
        })

        // ── cleanup: garbage collect ─────────────────────────────────────────
        const cleanup = Effect.fnUntraced(function* () {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* enabled())) return
              if (!(yield* exists(path.join(state.worktree, ".jj")))) return
              const result = yield* jj(["git", "gc"])
              if (result.code !== 0) {
                log.warn("cleanup failed", { exitCode: result.code, stderr: result.stderr })
              }
            }),
          )
        })

        yield* cleanup().pipe(
          Effect.catch(() => Effect.void),
          Effect.repeat(Schedule.spaced(Duration.hours(1))),
          Effect.delay(Duration.minutes(1)),
          Effect.forkScoped,
        )

        return { cleanup, track, patch, restore, revert, diff, diffFull }
      }),
    )

    return Service.of({
      init: Effect.fn("Snapshot.init")(function* () {
        yield* InstanceState.get(state)
      }),
      cleanup: Effect.fn("Snapshot.cleanup")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.cleanup())
      }),
      track: Effect.fn("Snapshot.track")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.track())
      }),
      patch: Effect.fn("Snapshot.patch")(function* (hash: string) {
        return yield* InstanceState.useEffect(state, (s) => s.patch(hash))
      }),
      restore: Effect.fn("Snapshot.restore")(function* (snapshot: string) {
        return yield* InstanceState.useEffect(state, (s) => s.restore(snapshot))
      }),
      revert: Effect.fn("Snapshot.revert")(function* (patches: Patch[]) {
        return yield* InstanceState.useEffect(state, (s) => s.revert(patches))
      }),
      diff: Effect.fn("Snapshot.diff")(function* (hash: string) {
        return yield* InstanceState.useEffect(state, (s) => s.diff(hash))
      }),
      diffFull: Effect.fn("Snapshot.diffFull")(function* (from: string, to: string) {
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

export * as Snapshot from "."
