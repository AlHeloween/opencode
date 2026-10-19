import { describe, expect, setDefaultTimeout } from "bun:test"
import { Effect, Layer } from "effect"
import * as fs from "fs/promises"
import path from "path"
import { Session } from "../../src/session/session"
import { SessionRevert } from "../../src/session/revert"
import { Snapshot } from "../../src/snapshot"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
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

describe("t98 undo probe (diagnostic, no predictions as evidence)", () => {
  it.live(
    "single-session undo restores file; concurrent second session change survival; leaves count",
    provideTmpdirInstance((worktree) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const revert = yield* SessionRevert.Service
        const snap = yield* Snapshot.Service
        const file = path.join(worktree, "a.txt")
        const other = path.join(worktree, "b.txt")

        const mkUser = (sid: SessionID, text: string) =>
          Effect.gen(function* () {
            const m = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: sid,
              agent: "build",
              model: MODEL,
              time: { created: Date.now() },
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: m.id,
              sessionID: sid,
              type: "text",
              text,
            })
            return m
          })
        const mkAssistantWithPatch = (sid: SessionID, parentID: MessageID, hash: string, files: string[]) =>
          Effect.gen(function* () {
            const m = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "assistant",
              sessionID: sid,
              parentID,
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
              messageID: m.id,
              sessionID: sid,
              type: "patch",
              hash,
              files,
            })
            return m
          })

        // Baseline v1
        yield* Effect.promise(() => fs.writeFile(file, "v1\n", "utf-8"))
        const h1 = (yield* snap.track([file])) ?? ""
        // Turn 1: v2
        yield* Effect.promise(() => fs.writeFile(file, "v2\n", "utf-8"))
        const h2 = (yield* snap.track([file])) ?? ""

        const sid1 = (yield* session.create({})).id
        const u1 = yield* mkUser(sid1, "first ask")
        // patch anchor = pre-turn leaf h1 (what processor records)
        yield* mkAssistantWithPatch(sid1, u1.id, h1, [file])

        // Concurrent second session writes b.txt + bumps a.txt to v3
        const sid2 = (yield* session.create({})).id
        yield* Effect.promise(() => fs.writeFile(other, "other\n", "utf-8"))
        yield* Effect.promise(() => fs.writeFile(file, "v3-concurrent\n", "utf-8"))
        const h3 = (yield* snap.track([file, other])) ?? ""

        const leafBefore = (yield* snap.checkpoint()) ?? "(none)"
        // Undo first session to its user message
        yield* revert.revert({ sessionID: sid1, messageID: u1.id })
        const state1 = yield* session.get(sid1)
        const aAfter = yield* Effect.promise(() => fs.readFile(file, "utf-8").catch(() => "(missing)"))
        const bAfter = yield* Effect.promise(() => fs.readFile(other, "utf-8").catch(() => "(missing)"))
        const leafAfter = (yield* snap.checkpoint()) ?? "(none)"

        console.log(
          JSON.stringify(
            { h1, h2, h3, leafBefore, leafAfter, revMessageID: state1.revert?.messageID ?? null, aAfter, bAfter },
            null,
            2,
          ),
        )
        // Diagnostic only: the test passes while printing the observation.
        expect(true).toBe(true)
      }),
    ),
  )
})
