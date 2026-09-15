/**
 * 2026-08-23 undo/redo stress profile: 10 000-file bank, 1 000 changed at once.
 * Measures snap.track over a tree with mass uncommitted changes and checks
 * whether revert rolls the mass-changed files back along with the target.
 * Run from packages/opencode:
 *   bun test ../../experiments/2026-08-23_fossil-smoke/2026-08-23_undo_scale10k.test.ts --timeout 180000
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
const FILE_COUNT = 10000
const CHANGE_COUNT = 1000

describe("undo scaling 10k", () => {
    it.live(
        `${FILE_COUNT} files, ${CHANGE_COUNT} changed at once`,
        provideTmpdirInstance((dir) =>
            Effect.gen(function* () {
                const session = yield* Session.Service
                const revert = yield* SessionRevert.Service
                const snap = yield* Snapshot.Service
                mark("services ready")

                yield* Effect.promise(() =>
                    (async () => {
                        for (let d = 0; d < 20; d++) {
                            await fs.mkdir(path.join(dir, `bank${d}`), { recursive: true })
                        }
                        for (let i = 0; i < FILE_COUNT; i++) {
                            await fs.writeFile(path.join(dir, `bank${i % 20}`, `f${i}.txt`), `content-${i}`, "utf-8")
                        }
                    })(),
                )
                mark(`bank of ${FILE_COUNT} files written`)

                const info = yield* session.create({})
                const target = path.join(dir, "note.txt")
                yield* Effect.promise(() => fs.writeFile(target, "v1", "utf-8"))

                const h1 = yield* snap.track([target])
                mark(`track #1 (full ${FILE_COUNT}-file tree) -> ${String(h1).slice(0, 12)}`)

                const mkUserPatch = function* (text: string, hash: string) {
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
                    yield* session.updatePart({
                        id: PartID.ascending(),
                        messageID: u.id,
                        sessionID: info.id,
                        type: "patch",
                        hash,
                        files: [target.replaceAll("\\", "/")],
                    })
                    return u
                }

                const user1 = yield* mkUserPatch("step1", h1!)
                mark("user1 + patch")

                yield* Effect.promise(() => fs.writeFile(target, "v2", "utf-8"))
                const h2 = yield* snap.track([target])
                mark(`track #2 -> ${String(h2).slice(0, 12)}`)
                const user2 = yield* mkUserPatch("step2", h2!)
                mark("user2 + patch")

                // Mass change: target + 1000 bank files.
                yield* Effect.promise(() => fs.writeFile(target, "v3", "utf-8"))
                yield* Effect.promise(() =>
                    (async () => {
                        for (let i = 0; i < CHANGE_COUNT; i++) {
                            await fs.writeFile(path.join(dir, `bank${i % 20}`, `f${i}.txt`), `CHANGED-${i}`, "utf-8")
                        }
                    })(),
                )
                mark(`${CHANGE_COUNT} bank files + target changed`)

                yield* snap.track([target])
                mark(`track #3 (commit over ${CHANGE_COUNT} dirty files)`)

                yield* revert.revert({ sessionID: info.id, messageID: user2.id })
                mark("revert done")

                expect(yield* Effect.promise(() => fs.readFile(target, "utf-8"))).toBe("v2")
                const probe = yield* Effect.promise(() =>
                    fs.readFile(path.join(dir, "bank7", "f7.txt"), "utf-8"),
                )
                mark(`mass-change rollback probe (bank7/f7): "${probe}"`)
            }),
        ),
    )
})
