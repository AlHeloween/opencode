/**
 * Regression: a tracked path deleted outside Fossil between scans aborts
 * `commit --hash` with ENOENT ("no such file") while `changes` reports
 * nothing — freezing the tip so undo/redo/timeline all go stale.
 *
 * track() must reconcile the index toward disk truth (record deletion),
 * retry once, and advance the leaf. Reproduces via the addremove bootstrap
 * branch (track() with no paths), which is how legacy sweep residue got
 * indexed without any owning patch.part in the session DB.
 */
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Session } from "../../src/session/session"
import { SessionRevert } from "../../src/session/revert"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { Snapshot } from "../../src/snapshot"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const env = Layer.mergeAll(
    Session.defaultLayer,
    SessionRevert.defaultLayer,
    SnapshotFossil.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env)

describe("snapshot.track heal", () => {
    it.live(
        "advances the leaf when a swept-tracked path vanishes outside fossil",
        provideTmpdirInstance((dir) =>
            Effect.gen(function* () {
                const snap = yield* Snapshot.Service

                yield* Effect.promise(() => fs.writeFile(path.join(dir, "legacy.md"), "ancient plan", "utf-8"))
                yield* Effect.promise(() => fs.writeFile(path.join(dir, "note.txt"), "v1", "utf-8"))

                // Bootstrap branch (no paths): addremove sweeps legacy.md into the index.
                const h1 = yield* snap.track()
                expect(h1).toBeTruthy()

                // External deletion (git rm / explorer) that fossil never saw.
                yield* Effect.promise(() => fs.rm(path.join(dir, "legacy.md")))
                yield* Effect.promise(() => fs.writeFile(path.join(dir, "note.txt"), "v2", "utf-8"))

                const h2 = yield* snap.track([path.join(dir, "note.txt")])
                // Pre-fix this returned the stale beforeHash and the tip froze.
                expect(h2).toBeTruthy()
                expect(h2).not.toBe(h1)
            }),
        ),
    )
})
