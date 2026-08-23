/**
 * T3/T4 from plans/2026-08-23_undo_compact_concept.md:
 * undo past a visibility boundary (simulated compaction mask) crosses it:
 * pre-boundary hidden rows resurrect, post-boundary future hides, manifest
 * recorded; redo re-applies the mask exactly (flags inverted back, files forward).
 *
 * The boundary is simulated directly with info.compacted flags — the unit under
 * test is revert()/unrevert() crossing mechanics, not SessionCompaction.
 */
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Session } from "../../src/session/session"
import { SessionRevert } from "../../src/session/revert"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { Snapshot } from "../../src/snapshot"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
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

const MODEL = { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") }

describe("undo across visibility boundary", () => {
    it.live(
        "T3/T4: crossing undo resurrects history, redo re-applies the mask",
        provideTmpdirInstance((dir) =>
            Effect.gen(function* () {
                const session = yield* Session.Service
                const revert = yield* SessionRevert.Service
                const snap = yield* Snapshot.Service

                const info = yield* session.create({})
                const sid = info.id
                const file = path.join(dir, "note.txt")

                const mkUserPatch = (text: string, hash: string) =>
                    Effect.gen(function* () {
                        const u = yield* session.updateMessage({
                            id: MessageID.ascending(),
                            role: "user",
                            sessionID: sid,
                            agent: "build",
                            model: MODEL,
                            time: { created: Date.now() },
                        })
                        yield* session.updatePart({
                            id: PartID.ascending(),
                            messageID: u.id,
                            sessionID: sid,
                            type: "text",
                            text,
                        })
                        yield* session.updatePart({
                            id: PartID.ascending(),
                            messageID: u.id,
                            sessionID: sid,
                            type: "patch",
                            hash,
                            files: [file.replaceAll("\\", "/")],
                        })
                        return u
                    })

                // History: v1 -> step1 -> v2 -> step2 -> v3(tracked).
                yield* Effect.promise(() => fs.writeFile(file, "v1", "utf-8"))
                const h1 = yield* snap.track([file])
                const user1 = yield* mkUserPatch("step1", h1!)

                yield* Effect.promise(() => fs.writeFile(file, "v2", "utf-8"))
                const h2 = yield* snap.track([file])
                const user2 = yield* mkUserPatch("step2", h2!)

                yield* Effect.promise(() => fs.writeFile(file, "v3", "utf-8"))
                const h3 = yield* snap.track([file])
                expect(h3).toBeTruthy()

                // Simulate the compaction mask: everything below user2 is hidden.
                const before = yield* session.messages({ sessionID: sid, visibleOnly: false })
                for (const m of before) {
                    if (m.info.id < user2.id) {
                        m.info.compacted = true
                        yield* session.updateMessage(m.info)
                    }
                }


                // Crossing undo to a PRE-boundary (hidden) message: tail >=
                // user1 inverts — user1 resurrects, user2 becomes the hidden
                // discarded future. partID lands on user1's text part, so its
                // own patch is undone too: files return to the h1 leaf.
                yield* revert.revert({ sessionID: sid, messageID: user1.id })

                const afterUndo = yield* session.messages({ sessionID: sid, visibleOnly: false })
                const undoById = new Map(afterUndo.map((m) => [m.info.id, m]))
                expect(undoById.get(user1.id)?.info.compacted).toBe(false) // resurrected
                expect(undoById.get(user2.id)?.info.compacted).toBe(true) // future hidden
                const st = yield* session.get(sid)
                expect(st.revert?.crossing?.length ?? 0).toBeGreaterThanOrEqual(2)
                expect(yield* Effect.promise(() => fs.readFile(file, "utf-8"))).toBe("v1")

                // T4: redo re-applies the mask exactly.
                yield* revert.unrevert({ sessionID: sid })
                const afterRedo = yield* session.messages({ sessionID: sid, visibleOnly: false })
                const redoById = new Map(afterRedo.map((m) => [m.info.id, m]))
                expect(redoById.get(user1.id)?.info.compacted).toBe(true)
                expect(redoById.get(user2.id)?.info.compacted).toBe(false)
                expect(yield* Effect.promise(() => fs.readFile(file, "utf-8"))).toBe("v3")
            }),
        ),
    )
})
