/**
 * SP-03: Session undo against real Fossil snapshots (no mocks).
 * Git is project VCS; Fossil is agent snapshot/undo only.
 */
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Session } from "@/session/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionRevert } from "../../src/session/revert"
import { Snapshot } from "../../src/snapshot"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import * as Log from "@opencode-ai/core/util/log"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init()

const env = Layer.mergeAll(
  Session.defaultLayer,
  SessionRevert.defaultLayer,
  SnapshotFossil.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
)

const it = testEffect(env)

const write = (file: string, text: string) => Effect.promise(() => fs.writeFile(file, text, "utf-8"))
const read = (file: string) => Effect.promise(() => fs.readFile(file, "utf-8"))
const exists = (file: string) =>
  Effect.promise(() =>
    fs.access(file).then(
      () => true,
      () => false,
    ),
  )

/** User messages need ≥1 part so SessionRevert's part walk can set `rev`. */
const userWithText = Effect.fn("test.userWithText")(function* (
  session: Session.Interface,
  sessionID: SessionID,
  text = "go",
) {
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: user.id,
    sessionID,
    type: "text",
    text,
  })
  return user
})

describe("session undo + fossil (SP-03)", () => {
  it.live(
    "SU-1 single undo restores file to targetHash tree",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const revert = yield* SessionRevert.Service
        const snap = yield* Snapshot.Service

        const info = yield* session.create({})
        const sessionID = info.id
        const file = path.join(dir, "note.txt")

        yield* write(file, "v1")
        const h1 = yield* snap.track([file])
        expect(h1).toBeTruthy()

        const user1 = yield* userWithText(session, sessionID, "step1")
        const asst1 = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID,
          mode: "build",
          agent: "build",
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.make("openai"),
          parentID: user1.id,
          time: { created: Date.now() },
          finish: "end_turn",
        })
        // Patch hash = state BEFORE this step's change
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: asst1.id,
          sessionID,
          type: "patch",
          hash: h1!,
          files: [file.replaceAll("\\", "/")],
        })

        yield* write(file, "v2")
        const h2 = yield* snap.track([file])
        expect(h2).toBeTruthy()

        const user2 = yield* userWithText(session, sessionID, "step2")
        const asst2 = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID,
          mode: "build",
          agent: "build",
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.make("openai"),
          parentID: user2.id,
          time: { created: Date.now() },
          finish: "end_turn",
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: asst2.id,
          sessionID,
          type: "patch",
          hash: h2!,
          files: [file.replaceAll("\\", "/")],
        })

        yield* write(file, "v3")
        yield* snap.track([file])

        // Undo to user2: patches after = asst2 patch (hash h2 = tree with v2).
        yield* revert.revert({ sessionID, messageID: user2.id })
        expect(yield* read(file)).toBe("v2")
        const after = yield* session.get(sessionID)
        expect(after.revert?.snapshot).toBeTruthy()
        expect(after.revert?.op_id).toBe(after.revert?.snapshot)
      }),
    ),
  )

  it.live(
    "SU-2 undo then unrevert restores pre-undo content",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const revert = yield* SessionRevert.Service
        const snap = yield* Snapshot.Service

        const info = yield* session.create({})
        const sessionID = info.id
        const file = path.join(dir, "x.txt")

        yield* write(file, "before")
        const hBefore = yield* snap.track([file])

        const user = yield* userWithText(session, sessionID)
        const asst = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID,
          mode: "build",
          agent: "build",
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.make("openai"),
          parentID: user.id,
          time: { created: Date.now() },
          finish: "end_turn",
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: asst.id,
          sessionID,
          type: "patch",
          hash: hBefore!,
          files: [file.replaceAll("\\", "/")],
        })

        yield* write(file, "after-agent")
        yield* snap.track([file])

        yield* revert.revert({ sessionID, messageID: user.id })
        expect(yield* read(file)).toBe("before")

        yield* revert.unrevert({ sessionID })
        expect(yield* read(file)).toBe("after-agent")
        const cleared = yield* session.get(sessionID)
        expect(cleared.revert).toBeUndefined()
      }),
    ),
  )

  it.live(
    "SU-5 user-only untracked file survives undo",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const revert = yield* SessionRevert.Service
        const snap = yield* Snapshot.Service

        const info = yield* session.create({})
        const sessionID = info.id
        const file = path.join(dir, "agent.txt")
        const userFile = path.join(dir, "user-only.txt")

        yield* write(file, "a1")
        const h1 = yield* snap.track([file])

        const user = yield* userWithText(session, sessionID)
        const asst = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID,
          mode: "build",
          agent: "build",
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.make("openai"),
          parentID: user.id,
          time: { created: Date.now() },
          finish: "end_turn",
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: asst.id,
          sessionID,
          type: "patch",
          hash: h1!,
          files: [file.replaceAll("\\", "/")],
        })

        yield* write(file, "a2")
        yield* snap.track([file])
        yield* write(userFile, "keep-me")

        yield* revert.revert({ sessionID, messageID: user.id })
        expect(yield* read(file)).toBe("a1")
        expect(yield* exists(userFile)).toBe(true)
        expect(yield* read(userFile)).toBe("keep-me")
      }),
    ),
  )

  it.live(
    "SU-3 double undo uses fresh snapshot anchors each time",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const revert = yield* SessionRevert.Service
        const snap = yield* Snapshot.Service

        const info = yield* session.create({})
        const sessionID = info.id
        const file = path.join(dir, "steps.txt")

        yield* write(file, "s0")
        const h0 = yield* snap.track([file])

        const step = Effect.fn("test.step")(function* (content: string, parentHash: string) {
          const user = yield* userWithText(session, sessionID, content)
          const asst = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "assistant",
            sessionID,
            mode: "build",
            agent: "build",
            path: { cwd: dir, root: dir },
            cost: 0,
            tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ModelID.make("gpt-4"),
            providerID: ProviderID.make("openai"),
            parentID: user.id,
            time: { created: Date.now() },
            finish: "end_turn",
          })
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: asst.id,
            sessionID,
            type: "patch",
            hash: parentHash,
            files: [file.replaceAll("\\", "/")],
          })
          yield* write(file, content)
          const h = yield* snap.track([file])
          return { user, h: h! }
        })

        const s1 = yield* step("s1", h0!)
        const s2 = yield* step("s2", s1.h)

        yield* revert.revert({ sessionID, messageID: s2.user.id })
        const mid = yield* session.get(sessionID)
        const anchor1 = mid.revert?.snapshot
        expect(anchor1).toBeTruthy()
        expect(yield* read(file)).toBe("s1")

        yield* revert.revert({ sessionID, messageID: s1.user.id })
        const mid2 = yield* session.get(sessionID)
        const anchor2 = mid2.revert?.snapshot
        expect(anchor2).toBeTruthy()
        // Fresh anchor each undo (BUG-3) — must not reuse prior revert snapshot blindly
        expect(anchor2).not.toBe(anchor1)
        expect(yield* read(file)).toBe("s0")
      }),
    ),
  )

  it.live(
    "RT-1 revertTo invalid hash fails",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const snap = yield* Snapshot.Service
        yield* write(path.join(dir, "t.txt"), "x")
        yield* snap.track([path.join(dir, "t.txt")])
        const exit = yield* snap.revertTo("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef").pipe(Effect.exit)
        expect(exit._tag).toBe("Failure")
      }),
    ),
  )

  it.live(
    "SP-05 HISTORY_INVALID marker blocks restore",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const snap = yield* Snapshot.Service
        const file = path.join(dir, "marked.txt")
        yield* write(file, "v1")
        const h = yield* snap.track([file])
        expect(h).toBeTruthy()

        const projectId = Instance.project.id
        const marker = path.join(dir, ".opencode", "data", "fossil", projectId, "HISTORY_INVALID.json")
        yield* Effect.promise(async () => {
          await fs.mkdir(path.dirname(marker), { recursive: true })
          await fs.writeFile(
            marker,
            JSON.stringify({ at: new Date().toISOString(), backupPath: "snapshot.fsl.bak.test", reason: "test" }),
            "utf-8",
          )
        })

        const exit = yield* snap.restore(h!).pipe(Effect.exit)
        expect(exit._tag).toBe("Failure")
      }),
    ),
  )

  /**
   * Structure walk (user scenario):
   *   T0: h1, h2
   *   T1: h1, h2', h3
   *   T2: h1, h2', h3, h4
   * Undo: T2 → T1 → T0 (exact sets). Redo: T0 → T1 → T2.
   * No leftover h4 at T1, no leftover h3 at T0 — full leaf structure.
   */
  it.live(
    "structure: h1,h2 → h2',h3 → h4 undo/redo both directions",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const revert = yield* SessionRevert.Service
        const snap = yield* Snapshot.Service
        const info = yield* session.create({})
        const sessionID = info.id

        const listTxt = Effect.fn("listTxt")(function* () {
          const names = yield* Effect.promise(() => fs.readdir(dir))
          return names.filter((n) => n.endsWith(".txt")).sort()
        })

        const h1 = path.join(dir, "h1.txt")
        const h2 = path.join(dir, "h2.txt")
        const h3 = path.join(dir, "h3.txt")
        const h4 = path.join(dir, "h4.txt")

        // T0
        yield* write(h1, "h1")
        yield* write(h2, "h2")
        const t0 = yield* snap.track([h1, h2])
        expect(t0).toBeTruthy()

        // T1: modify h2, add h3
        const u1 = yield* userWithText(session, sessionID, "t1")
        const a1 = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID,
          mode: "build",
          agent: "build",
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.make("openai"),
          parentID: u1.id,
          time: { created: Date.now() },
          finish: "end_turn",
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: a1.id,
          sessionID,
          type: "patch",
          hash: t0!,
          files: [h2.replaceAll("\\", "/"), h3.replaceAll("\\", "/")],
        })
        yield* write(h2, "h2prime")
        yield* write(h3, "h3")
        const t1 = yield* snap.track([h2, h3])
        expect(t1).toBeTruthy()

        // T2: add h4
        const u2 = yield* userWithText(session, sessionID, "t2")
        const a2 = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID,
          mode: "build",
          agent: "build",
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.make("openai"),
          parentID: u2.id,
          time: { created: Date.now() },
          finish: "end_turn",
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: a2.id,
          sessionID,
          type: "patch",
          hash: t1!,
          files: [h4.replaceAll("\\", "/")],
        })
        yield* write(h4, "h4")
        yield* snap.track([h4])

        expect(yield* listTxt()).toEqual(["h1.txt", "h2.txt", "h3.txt", "h4.txt"])
        expect(yield* read(h2)).toBe("h2prime")

        // Undo → T1 structure
        yield* revert.revert({ sessionID, messageID: u2.id })
        expect(yield* listTxt()).toEqual(["h1.txt", "h2.txt", "h3.txt"])
        expect(yield* read(h2)).toBe("h2prime")
        expect(yield* exists(h4)).toBe(false)

        // Undo → T0 structure
        yield* revert.revert({ sessionID, messageID: u1.id })
        expect(yield* listTxt()).toEqual(["h1.txt", "h2.txt"])
        expect(yield* read(h2)).toBe("h2")
        expect(yield* exists(h3)).toBe(false)
        expect(yield* exists(h4)).toBe(false)

        const afterDeep = yield* session.get(sessionID)
        expect(afterDeep.revert?.redo_stack?.length).toBe(1)

        // Redo → T1
        yield* revert.unrevert({ sessionID })
        expect(yield* listTxt()).toEqual(["h1.txt", "h2.txt", "h3.txt"])
        expect(yield* read(h2)).toBe("h2prime")
        expect(yield* exists(h4)).toBe(false)

        // Redo → T2
        yield* revert.unrevert({ sessionID })
        expect(yield* listTxt()).toEqual(["h1.txt", "h2.txt", "h3.txt", "h4.txt"])
        expect(yield* read(h2)).toBe("h2prime")
        expect(yield* read(h4)).toBe("h4")
        const cleared = yield* session.get(sessionID)
        expect(cleared.revert).toBeUndefined()
      }),
    ),
  )

  /**
   * P3: Rename/move full-leaf oracle.
   * T0: a.txt = "A"
   * T1: a → b (fs rename), b = "B-edited"
   * Undo T0 → only a="A", no b
   * Redo T1 → only b="B-edited", no a
   */
  it.live(
    "P3 rename/move: undo leaves only a.txt; redo only b.txt",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const revert = yield* SessionRevert.Service
        const snap = yield* Snapshot.Service
        const info = yield* session.create({})
        const sessionID = info.id

        const a = path.join(dir, "a.txt")
        const b = path.join(dir, "b.txt")

        yield* write(a, "A")
        const t0 = yield* snap.track([a])
        expect(t0).toBeTruthy()

        const u1 = yield* userWithText(session, sessionID, "rename")
        const a1 = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID,
          mode: "build",
          agent: "build",
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.make("openai"),
          parentID: u1.id,
          time: { created: Date.now() },
          finish: "end_turn",
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: a1.id,
          sessionID,
          type: "patch",
          hash: t0!,
          files: [a.replaceAll("\\", "/"), b.replaceAll("\\", "/")],
        })

        // Rename + edit (fs move; track both paths so leaf records new name)
        yield* Effect.promise(() => fs.rename(a, b))
        yield* write(b, "B-edited")
        const t1 = yield* snap.track([a, b])
        expect(t1).toBeTruthy()

        expect(yield* exists(a)).toBe(false)
        expect(yield* exists(b)).toBe(true)
        expect(yield* read(b)).toBe("B-edited")

        // Undo → T0
        yield* revert.revert({ sessionID, messageID: u1.id })
        expect(yield* exists(a)).toBe(true)
        expect(yield* read(a)).toBe("A")
        expect(yield* exists(b)).toBe(false)

        // Redo → T1
        yield* revert.unrevert({ sessionID })
        expect(yield* exists(a)).toBe(false)
        expect(yield* exists(b)).toBe(true)
        expect(yield* read(b)).toBe("B-edited")
      }),
    ),
  )
})
