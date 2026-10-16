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
import { provideInstance, tmpdir } from "../fixture/fixture"

// t62 (plan 2026-10-15_local-ticket-write.md T1 RED): the ticket write runs under the
// SAME per-repo semaphore as every other fossil call. Same instrument as
// fossil-lock.test.ts (stubbed fossil + in-flight peak) — the falsifier is the same
// shape: bypass `locked` for the ticket path and this file must go red.

setDefaultTimeout(20_000)

afterEach(async () => {
  await Instance.disposeAll()
  Bun.gc(true)
})

const encoder = new TextEncoder()
const HASH = "b".repeat(40)
const TICKET_UUID = "c".repeat(40)

function answer(args: readonly string[]): { code: number; text?: string; stderr?: string } {
  const sub = args[0]
  if (sub === "ticket") {
    if (args.includes("add")) return { code: 0, text: `ticket add succeeded for ${TICKET_UUID}\n` }
    return { code: 0, text: `ticket set succeeded for ${TICKET_UUID}\n` }
  }
  if (sub === "commit") return { code: 0, text: `New_Version: ${HASH}\n` }
  if (sub === "info") return { code: 0, text: `checkout: ${HASH}\n` }
  if (sub === "changes") return { code: 0, text: `EDITED ${args[args.length - 1]}\n` }
  return { code: 0 }
}

type Probe = {
  inFlight: number
  peak: number
  calls: string[][]
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
          yield* Effect.sleep("20 millis")
          probe.inFlight--
          probe.finished++
          return handle(answer(args))
        }),
      )
    }),
  ).pipe(Layer.provide(CrossSpawnSpawner.defaultLayer))
}

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

test("FALSIFIER — ticketAdd shares the per-repo permit with track (peak fossil in-flight == 1)", async () => {
  const probe: Probe = { inFlight: 0, peak: 0, calls: [], finished: 0 }
  await using tmp = await tmpdir({ git: true })

  const [uuid] = await Instance.provide({
    directory: tmp.path,
    fn: () =>
      run(tmp.path, probe, (snapshot) =>
        Effect.all([snapshot.ticketAdd({ title: "t62 lock probe" })], { concurrency: 1 }),
      ),
  })

  // CONTROL FIRST — the ticket write must actually have run, not skipped.
  expect(uuid).toBe(TICKET_UUID)
  const log = probe.calls.map((argv) => argv.join(" "))
  expect(log.some((line) => line.includes("ticket") && line.includes("add"))).toBe(true)

  // THE MEASUREMENT — with a concurrent snapshot write the permit still holds.
  const probe2: Probe = { inFlight: 0, peak: 0, calls: [], finished: 0 }
  await Instance.provide({
    directory: tmp.path,
    fn: () =>
      run(tmp.path, probe2, (snapshot) =>
        Effect.all([snapshot.ticketAdd({ title: "t62 lock probe 2" }), snapshot.track()], {
          concurrency: 2,
        }),
      ),
  })
  expect(probe2.peak).toBe(1)
  expect(probe2.inFlight).toBe(0)
})
