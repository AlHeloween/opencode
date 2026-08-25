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
import { SessionCompaction } from "../../src/session/compaction"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
const env = Layer.mergeAll(
    Session.defaultLayer,
    SessionRevert.defaultLayer,
    SnapshotFossil.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    SessionCompaction.defaultLayer.pipe(
        Layer.provide(Bus.layer),
        Layer.provide(Config.defaultLayer),
        Layer.provide(Session.defaultLayer),
    ),
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
    it.live(
        "T5/T6: fold deletes only discarded future; second undo resurrects again",
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

                yield* Effect.promise(() => fs.writeFile(file, "v1", "utf-8"))
                const h1 = yield* snap.track([file])
                const user1 = yield* mkUserPatch("step1", h1!)
                yield* Effect.promise(() => fs.writeFile(file, "v2", "utf-8"))
                const h2 = yield* snap.track([file])
                const user2 = yield* mkUserPatch("step2", h2!)
                yield* Effect.promise(() => fs.writeFile(file, "v3", "utf-8"))
                const h3 = yield* snap.track([file])
                const user3 = yield* mkUserPatch("step3", h3!)
                expect(user3).toBeTruthy()

                // Mask: deep archive below user3 — user1 and user2 hidden.
                const before = yield* session.messages({ sessionID: sid, visibleOnly: false })
                for (const m of before) {
                    if (m.info.id < user3.id) {
                        m.info.compacted = true
                        yield* session.updateMessage(m.info)
                    }
                }

                // T5: crossing undo to user2, then the next-prompt fold.
                yield* revert.revert({ sessionID: sid, messageID: user2.id })
                const foldedSession = yield* session.get(sid)
                yield* revert.cleanup(foldedSession)

                const afterFold = yield* session.messages({ sessionID: sid, visibleOnly: false })
                const foldById = new Map(afterFold.map((m) => [m.info.id, m]))
                expect(foldById.has(user3.id)).toBe(false) // discarded future deleted
                expect(foldById.get(user2.id)?.info.compacted).toBe(false) // resurrected stays
                expect(foldById.get(user1.id)?.info.compacted).toBe(true) // deep archive hidden
                const cleared = yield* session.get(sid)
                expect(cleared.revert).toBeUndefined() // revert state consumed

                // T6: second crossing undo into the deep archive resurrects again.
                yield* revert.revert({ sessionID: sid, messageID: user1.id })
                const after2 = yield* session.messages({ sessionID: sid, visibleOnly: false })
                const by2 = new Map(after2.map((m) => [m.info.id, m]))
                expect(by2.get(user1.id)?.info.compacted).toBe(false) // resurrected
                expect(by2.get(user2.id)?.info.compacted).toBe(true) // future re-hidden
                expect(yield* Effect.promise(() => fs.readFile(file, "utf-8"))).toBe("v1")
                yield* revert.unrevert({ sessionID: sid })
                const after2r = yield* session.messages({ sessionID: sid, visibleOnly: false })
                const by2r = new Map(after2r.map((m) => [m.info.id, m]))
                expect(by2r.get(user1.id)?.info.compacted).toBe(true)
                expect(by2r.get(user2.id)?.info.compacted).toBe(false)
                // Redo returns to the pre-undo state of the SECOND undo (v2):
                // the first undo was never redone, so the world sits at h2.
                expect(yield* Effect.promise(() => fs.readFile(file, "utf-8"))).toBe("v2")
            }),
        ),
    )

    it.live(
        "real compaction: summary rows resurrect, message* hides and folds",
        provideTmpdirInstance((dir) =>
            Effect.gen(function* () {
                const session = yield* Session.Service
                const revert = yield* SessionRevert.Service
                const snap = yield* Snapshot.Service
                const compaction = yield* SessionCompaction.Service

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

                yield* Effect.promise(() => fs.writeFile(file, "v1", "utf-8"))
                const h1 = yield* snap.track([file])
                const user1 = yield* mkUserPatch("step1", h1!)
                yield* Effect.promise(() => fs.writeFile(file, "v2", "utf-8"))
                const h2 = yield* snap.track([file])
                const user2 = yield* mkUserPatch("step2", h2!)
                yield* Effect.promise(() => fs.writeFile(file, "v3", "utf-8"))
                const h3 = yield* snap.track([file])
                const user3 = yield* mkUserPatch("step3", h3!)

                // Real summary row (assistant child carrying summary + text):
                // the fold then packs a summary block, not just the tail.
                const asst = yield* session.updateMessage({
                    id: MessageID.ascending(),
                    role: "assistant",
                    sessionID: sid,
                    parentID: user2.id,
                    agent: "build",
                    mode: "build",
                    modelID: MODEL.modelID,
                    providerID: MODEL.providerID,
                    path: { cwd: dir, root: dir },
                    cost: 0,
                    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                    time: { created: Date.now() },
                    summary: true,
                })
                yield* session.updatePart({
                    id: PartID.ascending(),
                    messageID: asst.id,
                    sessionID: sid,
                    type: "text",
                    text: "Summary: steps 1-2 done, note at v3.",
                })

                yield* compaction.compact({
                    sessionID: sid,
                    model: MODEL,
                    agent: "build",
                    force: true,
                })

                const afterCompact = yield* session.messages({ sessionID: sid, visibleOnly: false })
                const star = afterCompact.find(
                    (m) =>
                        m.info.role === "user" &&
                        m.parts.some((p) => p.type === "text" && (p as { synthetic?: boolean }).synthetic),
                )
                expect(star).toBeTruthy()
                for (const m of afterCompact) {
                    if (m.info.id !== star!.info.id) expect(m.info.compacted).toBe(true)
                }

                // Crossing undo to a hidden pre-compact message: pre-boundary rows
                // (including the summary row) resurrect; the message* row hides.
                yield* revert.revert({ sessionID: sid, messageID: user2.id })
                const afterUndo = yield* session.messages({ sessionID: sid, visibleOnly: false })
                const byU = new Map(afterUndo.map((m) => [m.info.id, m]))
                expect(byU.get(user2.id)?.info.compacted).toBe(false)
                expect(byU.get(user3.id)?.info.compacted).toBe(false)
                expect(byU.get(asst.id)?.info.compacted).toBe(false) // summary foldable
                expect(byU.get(star!.info.id)?.info.compacted).toBe(true) // message* foldable
                expect(yield* Effect.promise(() => fs.readFile(file, "utf-8"))).toBe("v2")

                // Fold consumes the manifest: message* is physically deleted,
                // resurrected history (summary row included) stays visible.
                yield* revert.cleanup(yield* session.get(sid))
                const afterFold = yield* session.messages({ sessionID: sid, visibleOnly: false })
                const byF = new Map(afterFold.map((m) => [m.info.id, m]))
                expect(byF.has(star!.info.id)).toBe(false)
                expect(byF.get(asst.id)?.info.compacted).toBe(false)
                expect((yield* session.get(sid)).revert).toBeUndefined()

                // Second crossing into the deep archive resurrects again.
                yield* revert.revert({ sessionID: sid, messageID: user1.id })
                const after2 = yield* session.messages({ sessionID: sid, visibleOnly: false })
                const by2 = new Map(after2.map((m) => [m.info.id, m]))
                expect(by2.get(user1.id)?.info.compacted).toBe(false) // resurrected
                expect(by2.get(user2.id)?.info.compacted).toBe(true) // re-hidden
                expect(yield* Effect.promise(() => fs.readFile(file, "utf-8"))).toBe("v1")
                yield* revert.unrevert({ sessionID: sid })
                const after2r = yield* session.messages({ sessionID: sid, visibleOnly: false })
                const by2r = new Map(after2r.map((m) => [m.info.id, m]))
                expect(by2r.get(user1.id)?.info.compacted).toBe(true)
                expect(by2r.get(user2.id)?.info.compacted).toBe(false)
                // Redo returns to the pre-undo state of the SECOND undo: the
                // first undo was never redone, so the world sits at h2 (v2).
                expect(yield* Effect.promise(() => fs.readFile(file, "utf-8"))).toBe("v2")
            }),
        ),
    )
})
