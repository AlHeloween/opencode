/**
 * 2026-08-23 undo/redo latency profile (experiments lane).
 * Replicates SU-1 stage-by-stage with wall-clock markers to attribute
 * the >5s runtime: instance bootstrap vs snapshot.track vs revert.
 * Run from packages/opencode: bun test ../../experiments/2026-08-23_fossil-smoke/2026-08-23_undo_profile.test.ts
 */
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Session } from "../../packages/opencode/src/session/session"
import { SessionRevert } from "../../packages/opencode/src/session/revert"
import { SnapshotFossil } from "../../packages/opencode/src/snapshot/fossil"
import { Snapshot } from "../../packages/opencode/src/snapshot"
import * as Log from "../../packages/core/src/util/log"
import { MessageID, PartID } from "../../packages/opencode/src/session/schema"
import { ModelID, ProviderID } from "../../packages/opencode/src/provider/schema"
import { CrossSpawnSpawner } from "../../packages/core/src/cross-spawn-spawner"
import { provideTmpdirInstance } from "../../packages/opencode/test/fixture/fixture"
import { testEffect } from "../../packages/opencode/test/lib/effect"

Log.init({ logLevel: "INFO", print: true })

const env = Layer.mergeAll(
    Session.defaultLayer,
    SessionRevert.defaultLayer,
    SnapshotFossil.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env)

const t0 = Date.now()
const mark = (label: string) => console.log(`[+${String(Date.now() - t0).padStart(6)}ms] ${label}`)

describe("undo profile", () => {
    it.live(
        "SU-1 stages timed",
        provideTmpdirInstance((dir) =>
            Effect.gen(function* () {
                const session = yield* Session.Service
                const revert = yield* SessionRevert.Service
                const snap = yield* Snapshot.Service
                mark("services ready")

                const info = yield* session.create({})
                mark("session.create")
                const file = path.join(dir, "note.txt")

                yield* Effect.promise(() => fs.writeFile(file, "v1", "utf-8"))
                const h1 = yield* snap.track([file])
                mark(`track #1 -> ${String(h1).slice(0, 12)}`)

                const user1 = yield* session.updateMessage({
                    id: MessageID.ascending(),
                    role: "user",
                    sessionID: info.id,
                    agent: "build",
                    model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
                    time: { created: Date.now() },
                })
                yield* session.updatePart({
                    id: PartID.ascending(),
                    messageID: user1.id,
                    sessionID: info.id,
                    type: "text",
                    text: "step1",
                })
                // Patch part binds step → snapshot hash (required for revert targeting).
                yield* session.updatePart({
                    id: PartID.ascending(),
                    messageID: user1.id,
                    sessionID: info.id,
                    type: "patch",
                    hash: h1!,
                    files: [file.replaceAll("\\", "/")],
                })
                mark("user1 + patch written")

                yield* Effect.promise(() => fs.writeFile(file, "v2", "utf-8"))
                const h2raw = yield* snap.track([file])
                mark(`track #2 -> ${String(h2raw).slice(0, 12)}`)

                const user2 = yield* session.updateMessage({
                    id: MessageID.ascending(),
                    role: "user",
                    sessionID: info.id,
                    agent: "build",
                    model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
                    time: { created: Date.now() },
                })
                yield* session.updatePart({
                    id: PartID.ascending(),
                    messageID: user2.id,
                    sessionID: info.id,
                    type: "text",
                    text: "step2",
                })
                yield* session.updatePart({
                    id: PartID.ascending(),
                    messageID: user2.id,
                    sessionID: info.id,
                    type: "patch",
                    hash: h2raw!,
                    files: [file.replaceAll("\\", "/")],
                })
                mark("user2 + patch written")

                yield* Effect.promise(() => fs.writeFile(file, "v3", "utf-8"))
                yield* snap.track([file])
                mark("track #3")

                yield* revert.revert({ sessionID: info.id, messageID: user2.id })
                mark("revert done")
                expect(yield* Effect.promise(() => fs.readFile(file, "utf-8"))).toBe("v2")
                mark("assert ok")
            }),
        ),
    )
})
