import { describe, expect, test, afterAll } from "bun:test"
import { Effect } from "effect"
import { Checkpoint, type CheckpointData } from "../../src/session/checkpoint"
import fs from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"

function makeCheckpointData(overrides: Partial<CheckpointData> = {}): CheckpointData {
  return {
    kind: Checkpoint.CHECKPOINT_KIND,
    version: Checkpoint.CHECKPOINT_VERSION,
    systemPrompt: ["[session: test_session]", "You are a test assistant."],
    messages: [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi there" },
    ],
    messageIDs: ["msg_001", "msg_002"],
    model: { providerID: "test-provider", modelID: "test-model" },
    turn: 3,
    timestamp: Date.now(),
    ...overrides,
  }
}

const TEST_PROJECT = "checkpoint-test-project"
const TEST_WORKTREE = "/tmp/checkpoint-test-worktree"
const SID = `ses_ckpt_${Date.now().toString(36)}`

// Clean up after all tests
afterAll(async () => {
  await Effect.runPromise(Checkpoint.remove(SID))
  await Effect.runPromise(Checkpoint.remove(`${SID}_b`))
  await Effect.runPromise(Checkpoint.remove(`${SID}_c`))
  await Effect.runPromise(Checkpoint.remove(`${SID}_d`))
  await Effect.runPromise(Checkpoint.remove(`${SID}_e`))
  await Effect.runPromise(Checkpoint.remove(`${SID}_f`))
})

describe("Checkpoint", () => {
  test("save and load round-trip", async () => {
    const data = makeCheckpointData({ model: { providerID: "rt", modelID: "rt-model" } })

    await Effect.runPromise(
      Checkpoint.save({ sessionID: SID, projectID: TEST_PROJECT, worktree: TEST_WORKTREE, data }),
    )

    const loaded = await Effect.runPromise(
      Checkpoint.load({ sessionID: SID, providerID: "rt", modelID: "rt-model", projectID: TEST_PROJECT, worktree: TEST_WORKTREE }),
    )

    expect(loaded).not.toBeNull()
    expect(loaded!.kind).toBe(Checkpoint.CHECKPOINT_KIND)
    expect(loaded!.systemPrompt).toEqual(data.systemPrompt)
    expect(loaded!.messages).toEqual(data.messages)
    expect(loaded!.messageIDs).toEqual(data.messageIDs)
    expect(loaded!.model).toEqual(data.model)
    expect(loaded!.turn).toBe(3)
  })

  test("load returns null when no checkpoint exists", async () => {
    const loaded = await Effect.runPromise(
      Checkpoint.load({ sessionID: `${SID}_nonexistent`, providerID: "x", modelID: "x", projectID: TEST_PROJECT, worktree: TEST_WORKTREE }),
    )
    expect(loaded).toBeNull()
  })

  test("overwrite — second save replaces first", async () => {
    const sid = `${SID}_b`
    const first = makeCheckpointData({ model: { providerID: "ow", modelID: "ow-model" }, turn: 1, systemPrompt: ["first"] })
    const second = makeCheckpointData({ model: { providerID: "ow", modelID: "ow-model" }, turn: 2, systemPrompt: ["second"] })

    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, worktree: TEST_WORKTREE, data: first }))
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, worktree: TEST_WORKTREE, data: second }))

    const loaded = await Effect.runPromise(
      Checkpoint.load({ sessionID: sid, providerID: "ow", modelID: "ow-model", projectID: TEST_PROJECT, worktree: TEST_WORKTREE }),
    )
    expect(loaded).not.toBeNull()
    expect(loaded!.turn).toBe(2)
    expect(loaded!.systemPrompt).toEqual(["second"])
  })

  test("different models have independent checkpoints", async () => {
    const sid = `${SID}_c`
    const dataA = makeCheckpointData({ model: { providerID: "im", modelID: "model-a" }, systemPrompt: ["Model A"] })
    const dataB = makeCheckpointData({ model: { providerID: "im", modelID: "model-b" }, systemPrompt: ["Model B"] })

    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, worktree: TEST_WORKTREE, data: dataA }))
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, worktree: TEST_WORKTREE, data: dataB }))

    const loadedA = await Effect.runPromise(Checkpoint.load({ sessionID: sid, providerID: "im", modelID: "model-a", projectID: TEST_PROJECT, worktree: TEST_WORKTREE }))
    const loadedB = await Effect.runPromise(Checkpoint.load({ sessionID: sid, providerID: "im", modelID: "model-b", projectID: TEST_PROJECT, worktree: TEST_WORKTREE }))

    expect(loadedA!.systemPrompt).toEqual(["Model A"])
    expect(loadedB!.systemPrompt).toEqual(["Model B"])
  })

  test("remove deletes all checkpoint files for session", async () => {
    const sid = `${SID}_d`
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, worktree: TEST_WORKTREE, data: makeCheckpointData({ model: { providerID: "rm", modelID: "rm-a" } }) }))
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, worktree: TEST_WORKTREE, data: makeCheckpointData({ model: { providerID: "rm", modelID: "rm-b" } }) }))

    await Effect.runPromise(Checkpoint.remove(sid))

    const loadedA = await Effect.runPromise(Checkpoint.load({ sessionID: sid, providerID: "rm", modelID: "rm-a", projectID: TEST_PROJECT, worktree: TEST_WORKTREE }))
    const loadedB = await Effect.runPromise(Checkpoint.load({ sessionID: sid, providerID: "rm", modelID: "rm-b", projectID: TEST_PROJECT, worktree: TEST_WORKTREE }))
    expect(loadedA).toBeNull()
    expect(loadedB).toBeNull()
  })

  test("atomic write — only .enc file exists, no .tmp leftovers", async () => {
    const sid = `${SID}_e`
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, worktree: TEST_WORKTREE, data: makeCheckpointData({ model: { providerID: "aw", modelID: "aw-model" } }) }))

    const baselinesDir = path.join(Global.Path.log, ".baselines")
    const files = fs.readdirSync(baselinesDir).filter((f) => f.includes(sid))
    expect(files.length).toBe(1)
    expect(files[0]).toEndWith(".enc")
  })

  test("load handles corrupt file gracefully", async () => {
    const sid = `${SID}_f`
    const data = makeCheckpointData({ model: { providerID: "cr", modelID: "cr-model" } })
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, worktree: TEST_WORKTREE, data }))

    // Corrupt the file by overwriting with garbage
    const baselinesDir = path.join(Global.Path.log, ".baselines")
    const files = fs.readdirSync(baselinesDir).filter((f) => f.includes(sid))
    const corruptPath = path.join(baselinesDir, files[0])
    fs.writeFileSync(corruptPath, Buffer.from("not-valid-encrypted-data"))

    const loaded = await Effect.runPromise(
      Checkpoint.load({ sessionID: sid, providerID: "cr", modelID: "cr-model", projectID: TEST_PROJECT, worktree: TEST_WORKTREE }),
    )
    expect(loaded).toBeNull()
    expect(fs.existsSync(corruptPath)).toBeFalse()
  })
})
