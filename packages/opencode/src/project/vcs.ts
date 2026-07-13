import { Effect, Layer, Context, Schema, Stream, Scope } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { createPatch } from "@/util/diff-wasm"
import path from "path"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { FileWatcher } from "@/file/watcher"
import { ensureRuntimeDataIgnored, isRuntimeDataPath } from "@/project/gitignore"
import * as Log from "@opencode-ai/core/util/log"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const log = Log.create({ service: "vcs" })

const count = (text: string) => {
  if (!text) return 0
  if (!text.endsWith("\n")) return text.split("\n").length
  return text.slice(0, -1).split("\n").length
}

const work = Effect.fnUntraced(function* (fs: AppFileSystem.Interface, cwd: string, file: string) {
  const full = path.join(cwd, file)
  if (!(yield* fs.exists(full).pipe(Effect.orDie))) return ""
  const buf = yield* fs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
  if (Buffer.from(buf).includes(0)) return ""
  return Buffer.from(buf).toString("utf8")
})

// Local types replacing Git.Service types
interface Item {
  code: string
  file: string
}

interface Stat {
  file: string
  additions: number
  deletions: number
}

interface Base {
  name: string
  ref: string
}

// Direct git spawn helpers — replaces Git.Service calls with inline ChildProcessSpawner
const gitCfg = [
  "--no-optional-locks",
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.longpaths=true",
  "-c",
  "core.symlinks=true",
  "-c",
  "core.quotepath=false",
] as const

type GitResult = { exitCode: number; text(): string; stderr(): string }

// Git helper factory — takes a spawner and returns bound git helper functions.
const makeGitHelpers = (spawner: { spawn: (...args: any[]) => any }) => {
  const gitRun = ((args: string[], opts?: { cwd?: string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const proc = ChildProcess.make("git", [...gitCfg, ...args], {
          cwd: opts?.cwd,
          extendEnv: true,
        })
        const handle = yield* spawner.spawn(proc)
        const [text, stderr] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
          { concurrency: 2 },
        )
        const code = yield* handle.exitCode
        return {
          exitCode: code as number,
          text: () => text.trim(),
          stderr: () => stderr,
        }
      }),
    ).pipe(
      Effect.catch((err) =>
        Effect.succeed({
          exitCode: 1,
          text: () => "",
          stderr: () => err instanceof Error ? err.message : String(err),
        }),
      ),
    )) as (args: string[], opts?: { cwd?: string }) => Effect.Effect<GitResult, never, never>

  return {
    branch: (cwd: string) => Effect.gen(function* () {
      const result = yield* gitRun(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd })
      if (result.exitCode !== 0) return undefined
      return result.text() || undefined
    }),

    defaultBranch: (cwd: string) => Effect.gen(function* () {
      const remote = yield* gitRun(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd })
      if (remote.exitCode === 0 && remote.text()) return { name: remote.text(), ref: `origin/${remote.text()}` } as Base
      const config = yield* gitRun(["config", "init.defaultBranch"], { cwd })
      if (config.exitCode === 0 && config.text()) return { name: config.text(), ref: config.text() } as Base
      for (const candidate of ["main", "master"]) {
        const result = yield* gitRun(["rev-parse", "--verify", `refs/heads/${candidate}`], { cwd })
        if (result.exitCode === 0) return { name: candidate, ref: candidate } as Base
      }
      return undefined
    }),

    hasHead: (cwd: string) => Effect.gen(function* () {
      const result = yield* gitRun(["rev-parse", "--verify", "HEAD"], { cwd })
      return result.exitCode === 0
    }),

    mergeBase: (cwd: string, base: string, head?: string) => Effect.gen(function* () {
      const args = head ? ["merge-base", base, head] : ["merge-base", base]
      const result = yield* gitRun(args, { cwd })
      if (result.exitCode !== 0) return undefined
      return result.text() || undefined
    }),

    status: (cwd: string) => Effect.gen(function* () {
      const result = yield* gitRun(
        ["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z"], { cwd },
      )
      if (result.exitCode !== 0) return [] as Item[]
      return parseStatus(result.text())
    }),

    stats: (cwd: string, ref: string) => Effect.gen(function* () {
      const result = yield* gitRun(
        ["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, "--", "."], { cwd },
      )
      if (result.exitCode !== 0) return [] as Stat[]
      return parseStats(result.text(), cwd)
    }),

    diff: (cwd: string, ref: string) => Effect.gen(function* () {
      const result = yield* gitRun(
        ["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, "--", "."], { cwd },
      )
      if (result.exitCode !== 0) return [] as Item[]
      return parseDiffItems(result.text())
    }),

    show: (cwd: string, ref: string, file: string, prefix?: string) => Effect.gen(function* () {
      const p = prefix ? `${prefix}${file}` : file
      const result = yield* gitRun(["show", `${ref}:${p}`], { cwd })
      return result.text() || ""
    }),

    prefix: (cwd: string) => Effect.gen(function* () {
      const result = yield* gitRun(["rev-parse", "--show-prefix"], { cwd })
      if (result.exitCode !== 0) return ""
      return result.text() || ""
    }),
  }
}

const nuls = (text: string) => text.split("\0").filter(Boolean)

const parseStatus = (text: string): Item[] =>
  nuls(text).map((line) => ({
    code: line.slice(0, 2),
    file: line.slice(3),
  }))

const parseStats = (text: string, cwd: string): Stat[] =>
  nuls(text)
    .map((line) => {
      const [added, removed, ...fileParts] = line.split("\t")
      if (!fileParts.length) return undefined
      return {
        file: fileParts.join("\t"),
        additions: added === "-" ? 0 : parseInt(added, 10),
        deletions: removed === "-" ? 0 : parseInt(removed, 10),
      }
    })
    .filter((s): s is Stat => s !== undefined)

const parseDiffItems = (text: string): Item[] =>
  text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 1) === "?" ? "??" : line.slice(0, 1) === "D" ? "D " : line.slice(0, 2),
      file: line.slice(line.lastIndexOf("\t") + 1 || 1).trim(),
    }))

const nums = (list: Stat[]) =>
  new Map(list.map((item) => [item.file, { additions: item.additions, deletions: item.deletions }] as const))

const merge = (...lists: Item[][]) => {
  const out = new Map<string, Item>()
  lists.flat().forEach((item) => {
    if (!out.has(item.file)) out.set(item.file, item)
  })
  return [...out.values()]
}

const visibleItems = (list: Item[]) => list.filter((item) => !isRuntimeDataPath(item.file))
const visibleStats = (list: Stat[]) => list.filter((item) => !isRuntimeDataPath(item.file))

export const Mode = Schema.Literals(["git", "branch"]).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Mode = Schema.Schema.Type<typeof Mode>

export const Event = {
  BranchUpdated: BusEvent.define(
    "vcs.branch.updated",
    Schema.Struct({
      branch: Schema.optional(Schema.String),
    }),
  ),
}

export const Info = Schema.Struct({
  branch: Schema.optional(Schema.String),
  default_branch: Schema.optional(Schema.String),
})
  .annotate({ identifier: "VcsInfo" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export const FileDiff = Schema.Struct({
  file: Schema.String,
  patch: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
})
  .annotate({ identifier: "VcsFileDiff" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type FileDiff = Schema.Schema.Type<typeof FileDiff>

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly branch: () => Effect.Effect<string | undefined>
  readonly defaultBranch: () => Effect.Effect<string | undefined>
  readonly diff: (mode: Mode) => Effect.Effect<FileDiff[]>
}

interface State {
  current: string | undefined
  root: Base | undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Vcs") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Bus.Service | ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const g = makeGitHelpers(spawner)

    const files = Effect.fnUntraced(function* (
      fs: AppFileSystem.Interface,
      cwd: string,
      ref: string | undefined,
      list: Item[],
      map: Map<string, { additions: number; deletions: number }>,
    ) {
      const base = ref ? yield* g.prefix(cwd) : ""
      const patch = (file: string, before: string, after: string) =>
        Effect.promise(() => createPatch(before, after))
      const next = yield* Effect.forEach(
        list,
        (item) =>
          Effect.gen(function* () {
            const before = item.code === "??" || !ref ? "" : yield* g.show(cwd, ref, item.file, base)
            const after = item.code === "D " ? "" : yield* work(fs, cwd, item.file)
            const stat = map.get(item.file)
            return {
              file: item.file,
              patch: (yield* patch(item.file, before, after)) ?? "",
              additions: stat?.additions ?? (item.code === "??" ? count(after) : 0),
              deletions: stat?.deletions ?? (item.code === "D " ? count(before) : 0),
              status: item.code === "??" ? "added" : item.code === "D " ? "deleted" : "modified",
            } satisfies FileDiff
          }),
        { concurrency: 8 },
      )
      return next.toSorted((a, b) => a.file.localeCompare(b.file))
    })

    const track = Effect.fnUntraced(function* (
      fs: AppFileSystem.Interface,
      cwd: string,
      ref: string | undefined,
    ) {
      if (!ref) return yield* files(fs, cwd, ref, visibleItems(yield* g.status(cwd)), new Map())
      const [list, stats] = yield* Effect.all([g.status(cwd), g.stats(cwd, ref)], { concurrency: 2 })
      return yield* files(fs, cwd, ref, visibleItems(list), nums(visibleStats(stats)))
    })

    const compare = Effect.fnUntraced(function* (
      fs: AppFileSystem.Interface,
      cwd: string,
      ref: string,
    ) {
      const [list, stats, extra] = yield* Effect.all([g.diff(cwd, ref), g.stats(cwd, ref), g.status(cwd)], {
        concurrency: 3,
      })
      return yield* files(
        fs,
        cwd,
        ref,
        merge(
          visibleItems(list),
          visibleItems(extra.filter((item) => item.code === "??")),
        ),
        nums(visibleStats(stats)),
      )
    })

    const state = yield* InstanceState.make<State>(
      Effect.fn("Vcs.state")(function* (ctx) {
        if (ctx.project.vcs !== "git") {
          return { current: undefined, root: undefined }
        }

        const [current, root] = yield* Effect.all([g.branch(ctx.directory), g.defaultBranch(ctx.directory)], {
          concurrency: 2,
        })
        const value = { current, root }
        log.info("initialized", { branch: value.current, default_branch: value.root?.name })

        yield* bus.subscribe(FileWatcher.Event.Updated).pipe(
          Stream.filter((evt) => evt.properties.file.endsWith("HEAD")),
          Stream.runForEach((_evt) =>
            Effect.gen(function* () {
              const next = yield* g.branch(ctx.directory)
              if (next !== value.current) {
                log.info("branch changed", { from: value.current, to: next })
                value.current = next
                yield* bus.publish(Event.BranchUpdated, { branch: next })
              }
            }),
          ),
          Effect.forkScoped,
        )

        return value
      }),
    )

    return Service.of({
      init: Effect.fn("Vcs.init")(function* () {
        yield* InstanceState.get(state).pipe(Effect.forkIn(scope))
      }),
      branch: Effect.fn("Vcs.branch")(function* () {
        return yield* InstanceState.use(state, (x) => x.current)
      }),
      defaultBranch: Effect.fn("Vcs.defaultBranch")(function* () {
        return yield* InstanceState.use(state, (x) => x.root?.name)
      }),
      diff: Effect.fn("Vcs.diff")(function* (mode: Mode) {
        const value = yield* InstanceState.get(state)
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []
        yield* ensureRuntimeDataIgnored(fs, ctx.worktree)
        if (mode === "git") {
          return yield* track(fs, ctx.directory, (yield* g.hasHead(ctx.directory)) ? "HEAD" : undefined)
        }

        if (!value.root) return []
        if (value.current && value.current === value.root.name) return []
        const ref = yield* g.mergeBase(ctx.directory, value.root.ref)
        if (!ref) return []
        return yield* compare(fs, ctx.directory, ref)
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Bus.layer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

export * as Vcs from "./vcs"
