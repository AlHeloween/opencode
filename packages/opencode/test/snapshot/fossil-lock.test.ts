/**
 * R3 of `plans/2026-09-30_turn-commit-slot.md`: the per-repo ORDER the turn's commit relies
 * on is a MEASURED property, not a reading of the source.
 *
 * `snapshot/fossil.ts` keeps one `Semaphore.makeUnsafe(1)` per repository and runs every
 * fossil operation inside `locked(...)`, so two operations on one repo cannot interleave.
 * That claim is what decided R1 — no commit slot was built in the processor, because the
 * order already holds one layer down — and until now it rested on READING the code: the
 * full-stack snapshot suites fail only INDIRECTLY when that lock breaks, and even then a
 * concurrent pair may still leave a plausible repository behind, because fossil has its own
 * SQLite busy handling underneath. A property that decides a plan needs an instrument that
 * can fail on the property itself.
 *
 * The instrument is a STUBBED FOSSIL, not a production seam: the service is given a
 * `ChildProcessSpawner` that answers every `fossil` invocation itself and counts how many
 * are running at once. Nothing in `src/` changes, and no timing is asserted in either
 * direction — the stub's short sleep only gives an UNLOCKED pair somewhere to overlap,
 * while the per-repo permit is what makes the peak impossible to exceed one.
 *
 * The falsifier is a MUTATION, not an argument: make `locked` an identity in
 * `snapshot/fossil.ts` and this file must go red.
 */
import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import path from "path"
import { Effect, Layer, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Config } from "@/config/config"
import { Snapshot } from "../../src/snapshot"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "@/util/filesystem"
import { provideInstance, tmpdir } from "../fixture/fixture"

// Fossil spawns dominate the snapshot suites; bun's 5 s default turns a loaded machine into
// reds that say nothing about the code.
setDefaultTimeout(20_000)

afterEach(async () => {
  await Instance.disposeAll()
  Bun.gc(true)
})

const encoder = new TextEncoder()
const HASH = "a".repeat(40)

/**
 * What the stubbed fossil answers. Every branch drives `track()` to a COMPLETED commit: if
 * `changes --hash` reported nothing, `track` would take its early skip path and the run
 * under measurement would be a shorter program than the one this test claims to measure.
 */
function answer(args: readonly string[]): { code: number; text?: string; stderr?: string } {
  const sub = args[0]
  if (sub === "commit") return { code: 0, text: `New_Version: ${HASH}\n` }
  if (sub === "info") return { code: 0, text: `checkout: ${HASH}\n` }
  if (sub === "changes") return { code: 0, text: `EDITED ${args[args.length - 1]}\n` }
  return { code: 0 }
}

type Probe = {
  /** Fossil invocations started and not yet finished. */
  inFlight: number
  /** The largest value `inFlight` ever held — the measurement. */
  peak: number
  /** Every argv a fossil invocation was given, in order. */
  calls: string[][]
  /** Invocations that ran to completion — the control that reads the whole program. */
  finished: number
}

function handle(result: { code: number; text?: string; stderr?: string }) {
  const sink = { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(0),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: sink,
    stdout: result.text ? Stream.make(encoder.encode(result.text)) : Stream.empty,
    stderr: result.stderr ? Stream.make(encoder.encode(result.stderr)) : Stream.empty,
    all: Stream.empty,
    getInputFd: () => sink,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  })
}

/** Answers fossil itself; every other command goes to the real spawner untouched. */
function stubbedFossil(probe: Probe) {
  return Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.gen(function* () {
      const real = yield* ChildProcessSpawner.ChildProcessSpawner
      return ChildProcessSpawner.make(
        Effect.fnUntraced(function* (command) {
          const std = ChildProcess.isStandardCommand(command) ? command : undefined
          if (!path.basename(std?.command ?? "").toLowerCase().startsWith("fossil")) {
            return yield* real.spawn(command)
          }

          const args = std?.args ?? []
          probe.calls.push([...args])
          probe.inFlight++
          probe.peak = Math.max(probe.peak, probe.inFlight)
          // A spawned process occupies its slot while it runs; this stands in for that
          // lifetime, so a pair WITHOUT the permit has somewhere real to overlap.
          yield* Effect.sleep("20 millis")
          probe.inFlight--
          probe.finished++
          return handle(answer(args))
        }),
      )
    }),
  ).pipe(Layer.provide(CrossSpawnSpawner.defaultLayer))
}

/** The same stack `SnapshotFossil.defaultLayer` builds, with the fossil spawner replaced. */
function run<A>(dir: string, probe: Probe, body: (snapshot: Snapshot.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service
      return yield* body(snapshot)
    }).pipe(
      provideInstance(dir),
      Effect.provide(
        SnapshotFossil.layer.pipe(
          Layer.provide(stubbedFossil(probe)),
          Layer.provide(AppFileSystem.defaultLayer),
          Layer.provide(Config.defaultLayer),
        ),
      ),
    ),
  )
}

test("FALSIFIER — three concurrent track() calls on one repo never run fossil at once (plan R3)", async () => {
  const probe: Probe = { inFlight: 0, peak: 0, calls: [], finished: 0 }
  await using tmp = await tmpdir({ git: true })
  const a = path.join(tmp.path, "a.txt")
  const b = path.join(tmp.path, "b.txt")
  await Filesystem.write(a, "A")
  await Filesystem.write(b, "B")

  const hashes = await Instance.provide({
    directory: tmp.path,
    fn: () =>
      run(tmp.path, probe, (snapshot) =>
        Effect.all([snapshot.track([a]), snapshot.track([b]), snapshot.track([a])], { concurrency: 3 }),
      ),
  })

  // CONTROL FIRST — every call must actually have run. A permit that serialized by never
  // letting the others start would otherwise read as a pass, and so would a service that
  // had silently returned before touching fossil at all.
  expect(hashes.length).toBe(3)
  expect(hashes.every((hash) => /^[a-f0-9]{40}$/.test(hash ?? ""))).toBe(true)
  const log = probe.calls.map((argv) => argv.join(" "))
  expect(log.some((line) => line.includes("a.txt"))).toBe(true)
  expect(log.some((line) => line.includes("b.txt"))).toBe(true)

  // THE MEASUREMENT — one repository, one fossil operation at a time, however many callers.
  expect(probe.peak).toBe(1)
  expect(probe.inFlight).toBe(0)
})
