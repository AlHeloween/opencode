/**
 * Shared stdout/stderr capture for bash / cmd / run tools.
 *
 * Critical for TypeScript and other compilers that write diagnostics to **stderr**:
 * - Agents often use `2>&1` so errors land on stdout for pipes/parsers.
 * - Even without `2>&1`, we must fully drain **both** pipes before returning.
 * - Never use a bare race of `exitCode` vs a forked `handle.all` consumer — the
 *   process can exit while pipe buffers still hold data → "(no output)" and lost
 *   diagnostics that then break follow-on TS parsing.
 *
 * `2>&1` must never be stripped by strip-win (merge redirects are intentional).
 */
import { Deferred, Effect, Scope, Stream } from "effect"

export type ChunkHandler = (chunk: string) => Effect.Effect<unknown>

type ByteStream = Stream.Stream<Uint8Array, unknown>

/**
 * Fork independent consumers for stdout and stderr; return an Effect that
 * completes only after **both** pipes are fully drained (or failed safely).
 */
export const forkDrainStdoutStderr = (
  handle: { readonly stdout: ByteStream; readonly stderr: ByteStream },
  onChunk: ChunkHandler,
): Effect.Effect<Effect.Effect<void, never, never>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const outDone = yield* Deferred.make<void>()
    const errDone = yield* Deferred.make<void>()

    const consume = (stream: ByteStream, done: Deferred.Deferred<void, never>) =>
      Effect.forkScoped(
        Stream.runForEach(Stream.decodeText(stream), onChunk).pipe(
          // A stream error must not block the sibling pipe or exit wait forever.
          Effect.catchCause(() => Effect.void),
          Effect.ensuring(Deferred.succeed(done, undefined).pipe(Effect.asVoid)),
        ),
      )

    yield* consume(handle.stdout, outDone)
    yield* consume(handle.stderr, errDone)

    // Timeout on each pipe drain: on Windows, taskkill /T /F can close OS pipe
    // handles before Node.js streams emit 'end', causing indefinite hang.
    // 10s per pipe is generous — real output drains in milliseconds.
    // timeoutOrElse keeps the never error type (timeout → void, same as success).
    return Effect.gen(function* () {
      yield* Deferred.await(outDone).pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () => Effect.void,
        }),
      )
      yield* Deferred.await(errDone).pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () => Effect.void,
        }),
      )
    })
  })
