import path from "path"
import { Global } from "@opencode-ai/core/global"
import { NamedError } from "@opencode-ai/core/util/error"
import z from "zod"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Layer, RcMap, Context, TxReentrantLock } from "effect"

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

export type Error = AppFileSystem.Error | InstanceType<typeof NotFoundError>

export interface Interface {
  readonly read: <T>(key: string[]) => Effect.Effect<T, Error>
  readonly write: <T>(key: string[], content: T) => Effect.Effect<void, AppFileSystem.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Storage") {}

/**
 * The DIRECTORY a key maps to, under a data root — and the ONE place that mapping is written.
 *
 * `keyFile` is its file form: a key IS a path, and the `.json` suffix is the only difference between
 * them. The split is not cosmetic. A reader that ENUMERATES the store (the plan-ref invariant, plan
 * S5) needs the directory, and the obvious shortcut — composing `path.join(dataRoot, "storage", …)` a
 * second time beside this one — is exactly the drift the S3 defect measured: a writer and a reader
 * holding two spellings of one mapping agree until one of them is changed, and then disagree in
 * silence, in production and never in a test.
 */
export function keyDir(dataRoot: string, key: string[]): string {
  return path.join(dataRoot, "storage", ...key)
}

/**
 * The file a key maps to, under a data root.
 *
 * EXPORTED because a reader that cannot yield for the service needs the SAME mapping, not a second
 * spelling of it: the turn note is built on the prompt path, where a new service requirement
 * propagates into every layer that provides its consumer — the trade `tool/memory.ts` names and
 * answers the same way (service-free, rooted at the worktree). One key, one file, both sides.
 */
export function keyFile(dataRoot: string, key: string[]): string {
  return keyDir(dataRoot, key) + ".json"
}

function missing(err: unknown) {
  if (!err || typeof err !== "object") return false
  if ("code" in err && err.code === "ENOENT") return true
  if ("reason" in err && err.reason && typeof err.reason === "object" && "_tag" in err.reason) {
    return err.reason._tag === "NotFound"
  }
  return false
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const locks = yield* RcMap.make({
      lookup: () => TxReentrantLock.make(),
      idleTimeToLive: 0,
    })
    const fail = (target: string): Effect.Effect<never, InstanceType<typeof NotFoundError>> =>
      Effect.fail(new NotFoundError({ message: `Resource not found: ${target}` }))

    const wrap = <A>(target: string, body: Effect.Effect<A, AppFileSystem.Error>) =>
      body.pipe(Effect.catchIf(missing, () => fail(target)))

    const writeJson = Effect.fnUntraced(function* (target: string, content: unknown) {
      yield* fs.writeWithDirs(target, JSON.stringify(content, null, 2))
    })

    const withResolved = <A, E>(
      key: string[],
      fn: (target: string, rw: TxReentrantLock.TxReentrantLock) => Effect.Effect<A, E>,
    ): Effect.Effect<A, E | AppFileSystem.Error> =>
      Effect.scoped(
        Effect.gen(function* () {
          // THE ROOT IS RESOLVED PER OPERATION, not captured when the layer is built. Measured
          // 2026-09-30 by S3's own oracle: `project/instance.ts` calls `Global.initFromWorktree(ctx
          // .worktree)` when an instance is created, so a layer built BEFORE the instance — the app's at
          // start-up, a test's outside `provideTmpdirInstance` — captured a root belonging to a DIFFERENT
          // worktree, and every read and write went there. That is why the store survived across test
          // files and runs (a record written under one plan id turned another file's exact-set
          // assertion red), and it would have made a service-free reader report every manifest as
          // MISSING while the store held them: silent, permanent, invisible. Resolving here makes the
          // plane's root the CALLER's worktree, and lets `session/svm.ts`'s `readNote` resolve the same
          // file at the same moment BY CONSTRUCTION rather than by the accident that a process happens
          // to start inside its own worktree.
          const target = keyFile(Global.Path.data, key)
          return yield* fn(target, yield* RcMap.get(locks, target))
        }),
      )

    const read: Interface["read"] = <T>(key: string[]) =>
      Effect.gen(function* () {
        const value = yield* withResolved(key, (target, rw) =>
          TxReentrantLock.withReadLock(rw, wrap(target, fs.readJson(target))),
        )
        return value as T
      })

    const write: Interface["write"] = (key: string[], content: unknown) =>
      Effect.gen(function* () {
        yield* withResolved(key, (target, rw) => TxReentrantLock.withWriteLock(rw, writeJson(target, content)))
      })

    return Service.of({
      read,
      write,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as Storage from "./storage"
