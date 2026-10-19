import { describe, expect, setDefaultTimeout } from "bun:test"
import { Effect, Layer } from "effect"
import * as fs from "fs/promises"
import path from "path"
import { Session } from "../../src/session/session"
import { SessionRevert } from "../../src/session/revert"
import { Snapshot } from "../../src/snapshot"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionCompaction } from "../../src/session/compaction"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

setDefaultTimeout(20_000)

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

describe("t98 undo touches only its own turn", () => {
  it.live(
    "a concurrent session's disjoint file survives the undo",
    provideTmpdirInstance((worktree) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const revert = yield* SessionRevert.Service
        const snap = yield* Snapshot.Service
        const file = path.join(worktree, "a.txt")
        const other = path.join(worktree, "b.txt")


        yield* Effect.promise(() => fs.writeFile(file, "v1\n", "utf-8"))
        const h1 = (yield* snap.track([file])) ?? ""

        yield* Effect.promise(() => fs.writeFile(file, "v2\n", "utf-8"))
        yield* snap.track([file])

        const sid1 = (yield* session.create({})).id
        const u1 = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: sid1,
          agent: "build",
          model: MODEL,
          time: { created: Date.now() },
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: u1.id,
          sessionID: sid1,
          type: "text",
          text: "first ask",
        })
        const a1 = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: sid1,
          parentID: u1.id,
          agent: "build",
          mode: "primary",
          providerID: MODEL.providerID,
          modelID: MODEL.modelID,
          path: { cwd: worktree, root: worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: a1.id,
          sessionID: sid1,
          type: "patch",
          hash: h1,
          files: [file],
        })

        // Concurrent second session: disjoint file + same-file bump.
        yield* session.create({})
        yield* Effect.promise(() => fs.writeFile(other, "other\n", "utf-8"))
        yield* Effect.promise(() => fs.writeFile(file, "v3-concurrent\n", "utf-8"))
        yield* snap.track([file, other])

        yield* revert.revert({ sessionID: sid1, messageID: u1.id })

        const state1 = yield* session.get(sid1)
        const aAfter = yield* Effect.promise(() => fs.readFile(file, "utf-8").catch(() => "(missing)"))
        const bAfter = yield* Effect.promise(() => fs.readFile(other, "utf-8").catch(() => "(missing)"))

        // Own turn restored to its pre-turn state (a.txt is this turn's file).
        expect(aAfter).toBe("v1\n")
        expect(state1.revert?.messageID).toBe(u1.id)
        // Foreign disjoint work is not reverted away.
        expect(bAfter).toBe("other\n")
      }),
    ),
  )

  it.live(
    "single-session undo restores the file on the target leaf itself",
    provideTmpdirInstance((worktree) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const revert = yield* SessionRevert.Service
        const snap = yield* Snapshot.Service
        const file = path.join(worktree, "solo.txt")

        yield* Effect.promise(() => fs.writeFile(file, "v1\n", "utf-8"))
        const h1 = (yield* snap.track([file])) ?? ""

        yield* Effect.promise(() => fs.writeFile(file, "v2\n", "utf-8"))
        yield* snap.track([file])

        const sid = (yield* session.create({})).id
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
          text: "ask",
        })
        const a = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: sid,
          parentID: u.id,
          agent: "build",
          mode: "primary",
          providerID: MODEL.providerID,
          modelID: MODEL.modelID,
          path: { cwd: worktree, root: worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: a.id,
          sessionID: sid,
          type: "patch",
          hash: h1,
          files: [file],
        })

        yield* revert.revert({ sessionID: sid, messageID: u.id })

        const content = yield* Effect.promise(() => fs.readFile(file, "utf-8"))
        const leaf = (yield* snap.checkpoint()) ?? "(none)"
        expect(content).toBe("v1\n")
        // No preserve-merge leaf when nobody else wrote: the tree sits on the target.
        expect(leaf).toBe(h1)
      }),
    ),
  )
})
