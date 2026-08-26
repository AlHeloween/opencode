import { test, type TestOptions } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import * as Fiber from "effect/Fiber"
import type * as Scope from "effect/Scope"
import * as TestClock from "effect/testing/TestClock"
import * as TestConsole from "effect/testing/TestConsole"

type Body<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)

const body = <A, E, R>(value: Body<A, E, R>) => Effect.suspend(() => (typeof value === "function" ? value() : value))

const TIMEOUT_MARGIN_MS = 500

const run = <A, E, R, E2>(
  value: Body<A, E, R | Scope.Scope>,
  layer: Layer.Layer<R, E2>,
  opts?: number | TestOptions,
): Promise<A> => {
  // When the caller declares an explicit bun budget (it.live(name, fn, ms)),
  // enforce an INNER Effect deadline slightly below it. Bun's own timeout
  // abandons the fiber without interruption, so any acquired fixture lock
  // (tmpdirInstanceLock) stays held and every later test in the file starves.
  // Interrupting inside Effect runs scope finalizers -> locks released.
  const inner =
    typeof opts === "number" ? Math.max(opts - TIMEOUT_MARGIN_MS, 1_000) : undefined
  const program = body(value).pipe(Effect.scoped, Effect.provide(layer))
  return Effect.gen(function* () {
    let exit: Exit.Exit<A, E | E2 | Error>
    if (inner === undefined) {
      exit = yield* Effect.exit(program)
    } else {
      const fiber = yield* Effect.forkChild(program)
      const timer = yield* Effect.forkChild(
        Effect.gen(function* () {
          yield* Effect.sleep(`${inner} millis`)
          return yield* Effect.fail(
            new Error(
              `test body exceeded ${inner}ms (bun budget ${opts as number}ms) — fiber interrupted to release fixture locks`,
            ),
          )
        }),
      )
      exit = yield* Effect.raceFirst(Fiber.await(fiber), Fiber.await(timer))
      yield* Fiber.interrupt(fiber)
      yield* Fiber.interrupt(timer)
    }
    if (Exit.isFailure(exit)) {
      for (const err of Cause.prettyErrors(exit.cause)) {
        yield* Effect.logError(err)
      }
    }
    return yield* exit
  }).pipe(Effect.runPromise)
}

const make = <R, E>(testLayer: Layer.Layer<R, E>, liveLayer: Layer.Layer<R, E>) => {
  const effect = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test(name, () => run(value, testLayer, opts), opts)

  effect.only = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.only(name, () => run(value, testLayer, opts), opts)

  effect.skip = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.skip(name, () => run(value, testLayer, opts), opts)

  const live = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test(name, () => run(value, liveLayer, opts), opts)

  live.only = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.only(name, () => run(value, liveLayer, opts), opts)

  live.skip = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.skip(name, () => run(value, liveLayer, opts), opts)

  return { effect, live }
}

// Test environment with TestClock and TestConsole
const testEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())

// Live environment - uses real clock, but keeps TestConsole for output capture
const liveEnv = TestConsole.layer

export const it = make(testEnv, liveEnv)

export const testEffect = <R, E>(layer: Layer.Layer<R, E>) =>
  make(Layer.provideMerge(layer, testEnv), Layer.provideMerge(layer, liveEnv))
