/**
 * 2026-08-23 undo/redo scaling profile: does track/revert cost depend on
 * worktree file count? Creates FILE_COUNT small files, tracks them once,
 * then modifies ONE file and measures snap.track + revert wall time.
 * Run from packages/opencode:
 *   bun test ../../experiments/2026-08-23_fossil-smoke/2026-08-23_undo_scale.test.ts --timeout 60000
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
const FILE_COUNT = 1000

describe("undo scaling", () => {
    it.live(
        `SU-1 shape with ${FILE_COUNT}-file bank`,
        provideTmpdirInstance((dir) =>
            Effect.gen(function* () {
                const session = yield* Session.Service
                const revert = yield* SessionRevert.Service
                const snap = yield* Snapshot.Service
                mark("services ready")

                yield* Effect.promise(() =>
                    (async () => {
                        for (let d = 0; d < 10; d++) {
                            await fs.mkdir(path.join(dir, `bank${d}`), { recursive: true })
                        }
                        for (let i = 0; i < FILE_COUNT; i++) {
                            await fs.writeFile(path.join(dir, `bank${i % 10}`, `f${i}.txt`), `content-${i}`, "utf-8")
                        }
                    })(),
                )
                mark(`bank of ${FILE_COUNT} files written`)

                const info = yield* session.create({})
                const target = path.join(dir, "note.txt")
                yield* Effect.promise(() => fs.writeFile(target, "v1", "utf-8"))

                // Track #1: first snapshot sees the whole bank.
                const h1 = yield* snap.track([target])
                mark(`track #1 (full bank) -> ${String(h1).slice(0, 12)}`)

                const mkUser = (text: string) =>
                    Effect.gen(function* () {
                        const u = yield* session.updateMessage({
                            id: MessageID.ascending(),
                            role: "user",
                            sessionID: info.id,
                            agent: "build",
                            model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
                            time: { created: Date.now() },
                        })
                        yield* session.updatePart({
                            id: PartID.ascending(),
                            messageID: u.id,
                            sessionID: info.id,
                            type: "text",
                            text,
                        })
                        return u
                    })

                const user1 = yield* mkUser("step1")
                yield* session.updatePart({
                    id: PartID.ascending(),
                    messageID: user1.id,
                    sessionID: info.id,
                    type: "patch",
                    hash: h1!,
                    files: [target.replaceAll("\\", "/")],
                })
                mark("user1 + patch")

                yield* Effect.promise(() => fs.writeFile(target, "v2", "utf-8"))
                const h2 = yield* snap.track([target])
                mark(`track #2 (one file changed, bank present) -> ${String(h2).slice(0, 12)}`)

                const user2 = yield* mkUser("step2")
                yield* session.updatePart({
                    id: PartID.ascending(),
                    messageID: user2.id,
                    sessionID: info.id,
                    type: "patch",
                    hash: h2!,
                    files: [target.replaceAll("\\", "/")],
                })

                yield* Effect.promise(() => fs.writeFile(target, "v3", "utf-8"))
                yield* snap.track([target])
                mark("track #3")

                yield* revert.revert({ sessionID: info.id, messageID: user2.id })
                mark("revert done")
                expect(yield* Effect.promise(() => fs.readFile(target, "utf-8"))).toBe("v2")
                mark("assert ok: bank intact -> " +
                    String((yield* Effect.promise(() => fs.readFile(path.join(dir, "bank3", "f3.txt"), "utf-8")))).slice(0, 20))
            }),
        ),
    )
})
