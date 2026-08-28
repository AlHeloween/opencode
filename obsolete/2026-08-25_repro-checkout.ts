/**
 * Repro: drive SnapshotFossil checkout chain against the REAL repo worktree
 * (same path unrevert takes). 20s timeout exposes a hang. Checkout target =
 * current tip (content no-op) — safe by construction.
 * Run: bun test/scratch/repro-checkout.ts (from packages/opencode)
 */
import { Effect, Layer } from "effect"
import { Snapshot } from "../../src/snapshot"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideInstance } from "../fixture/fixture"

const program = Effect.gen(function* () {
    const snap = yield* Snapshot.Service
    const t0 = Date.now()
    console.log("[t=0] calling restore(e99f0cca...) — checkoutTo chain")
    yield* snap.restore("e99f0ccae30dd4d7409fe8bd7567722d7c0f530e")
    console.log(`[t=${Date.now() - t0}ms] restore COMPLETED`)
}).pipe(
    Effect.timeout("20 seconds"),
    Effect.catchCause((c) => Effect.sync(() => console.error("CAUSE:", c))),
)

const env = Layer.mergeAll(SnapshotFossil.defaultLayer, CrossSpawnSpawner.defaultLayer)

Effect.runPromise(
    program.pipe(provideInstance("d:/zPython/opencode"), Effect.provide(env)),
).then(() => console.log("done"), (e) => console.error("failed:", e))
