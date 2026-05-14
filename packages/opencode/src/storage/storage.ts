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

function file(dir: string, key: string[]) {
  return path.join(dir, ...key) + ".json"
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
    const state = yield* Effect.cached(Effect.succeed({ dir: path.join(Global.Path.data, "storage") }))

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
          const target = file((yield* state).dir, key)
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
