import { describe, expect, test, afterAll } from "bun:test"
import { Effect } from "effect"
import { Checkpoint, type CheckpointData } from "../../src/session/checkpoint"
import { RequestDiff } from "../../src/session/request-diff"
import fs from "fs"
import path from "path"

const DEFAULT_IDENTITY = "You are a test assistant."

function makeCheckpointData(overrides: Partial<CheckpointData> = {}): CheckpointData {
  const identity = overrides.systemPrompt?.[0] ?? DEFAULT_IDENTITY
  return {
    kind: Checkpoint.CHECKPOINT_KIND,
    version: Checkpoint.CHECKPOINT_VERSION,
    systemPrompt: ["[session: test_session]", "You are a test assistant."],
    identityFingerprint: Checkpoint.identityFingerprint(identity),
    messages: [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi there" },
    ],
    messageIDs: ["msg_001", "msg_002"],
    model: { providerID: "test-provider", modelID: "test-model" },
    agent: "test-agent",
    turn: 3,
    timestamp: Date.now(),
    ...overrides,
  }
}

const TEST_PROJECT = "checkpoint-test-project"
const SID = `ses_ckpt_${Date.now().toString(36)}`

// Clean up after all tests
afterAll(async () => {
  for (const s of [SID, `${SID}_b`, `${SID}_c`, `${SID}_d`, `${SID}_e`, `${SID}_f`, `${SID}_g`, `${SID}_h`, `${SID}_mem`, `${SID}_v3`]) {
    await Effect.runPromise(Checkpoint.remove(s))
  }
  RequestDiff.deleteBaselines(`${SID}_g`)
  RequestDiff.deleteBaselines(`${SID}_h`)
})

describe("Checkpoint", () => {
  test("save and load round-trip", async () => {
    const data = makeCheckpointData({ model: { providerID: "rt", modelID: "rt-model" } })

    await Effect.runPromise(
      Checkpoint.save({ sessionID: SID, projectID: TEST_PROJECT, data }),
    )

    const loaded = await Effect.runPromise(
      Checkpoint.load({ sessionID: SID, providerID: "rt", modelID: "rt-model", projectID: TEST_PROJECT, agentName: "test-agent" }),
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
      Checkpoint.load({ sessionID: `${SID}_nonexistent`, providerID: "x", modelID: "x", projectID: TEST_PROJECT, }),
    )
    expect(loaded).toBeNull()
  })

  test("overwrite — second save replaces first", async () => {
    const sid = `${SID}_b`
    const first = makeCheckpointData({ model: { providerID: "ow", modelID: "ow-model" }, turn: 1, systemPrompt: ["first"] })
    const second = makeCheckpointData({ model: { providerID: "ow", modelID: "ow-model" }, turn: 2, systemPrompt: ["second"] })

    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, data: first }))
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, data: second }))

    const loaded = await Effect.runPromise(
      Checkpoint.load({ sessionID: sid, providerID: "ow", modelID: "ow-model", projectID: TEST_PROJECT, agentName: "test-agent" }),
    )
    expect(loaded).not.toBeNull()
    expect(loaded!.turn).toBe(2)
    expect(loaded!.systemPrompt).toEqual(["second"])
  })

  test("different models have independent checkpoints", async () => {
    const sid = `${SID}_c`
    const dataA = makeCheckpointData({ model: { providerID: "im", modelID: "model-a" }, systemPrompt: ["Model A"] })
    const dataB = makeCheckpointData({ model: { providerID: "im", modelID: "model-b" }, systemPrompt: ["Model B"] })

    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, data: dataA }))
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, data: dataB }))

    const loadedA = await Effect.runPromise(Checkpoint.load({ sessionID: sid, providerID: "im", modelID: "model-a", projectID: TEST_PROJECT, agentName: "test-agent" }))
    const loadedB = await Effect.runPromise(Checkpoint.load({ sessionID: sid, providerID: "im", modelID: "model-b", projectID: TEST_PROJECT, agentName: "test-agent" }))

    expect(loadedA!.systemPrompt).toEqual(["Model A"])
    expect(loadedB!.systemPrompt).toEqual(["Model B"])
  })

  test("remove deletes all checkpoint files for session", async () => {
    const sid = `${SID}_d`
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, data: makeCheckpointData({ model: { providerID: "rm", modelID: "rm-a" } }) }))
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, data: makeCheckpointData({ model: { providerID: "rm", modelID: "rm-b" } }) }))

    await Effect.runPromise(Checkpoint.remove(sid))

    const loadedA = await Effect.runPromise(Checkpoint.load({ sessionID: sid, providerID: "rm", modelID: "rm-a", projectID: TEST_PROJECT, agentName: "test-agent" }))
    const loadedB = await Effect.runPromise(Checkpoint.load({ sessionID: sid, providerID: "rm", modelID: "rm-b", projectID: TEST_PROJECT, agentName: "test-agent" }))
    expect(loadedA).toBeNull()
    expect(loadedB).toBeNull()
  })

  test("atomic write — only .enc file exists, no .tmp leftovers", async () => {
    const sid = `${SID}_e`
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, data: makeCheckpointData({ model: { providerID: "aw", modelID: "aw-model" } }) }))

    const files = fs.readdirSync(Checkpoint.checkpointDir(sid)).filter((f) => f.includes(sid))
    expect(files.length).toBe(1)
    expect(files[0]).toEndWith(".enc")
  })

  test("load handles corrupt file gracefully", async () => {
    const sid = `${SID}_f`
    const data = makeCheckpointData({ model: { providerID: "cr", modelID: "cr-model" } })
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, data }))

    // Corrupt the file by overwriting with garbage
    const files = fs.readdirSync(Checkpoint.checkpointDir(sid)).filter((f) => f.includes(sid))
    const corruptPath = path.join(Checkpoint.checkpointDir(sid), files[0])
    fs.writeFileSync(corruptPath, Buffer.from("not-valid-encrypted-data"))
    Checkpoint.dropMemory(sid)

    const loaded = await Effect.runPromise(
      Checkpoint.load({ sessionID: sid, providerID: "cr", modelID: "cr-model", projectID: TEST_PROJECT, agentName: "test-agent" }),
    )
    expect(loaded).toBeNull()
    expect(fs.existsSync(corruptPath)).toBeFalse()
  })

  test("checkpoint save and load roundtrip", async () => {
    const sid = `${SID}_g`
    const providerID = "roundtrip-provider"
    const modelID = "roundtrip-model"
    const data = makeCheckpointData({
      model: { providerID, modelID },
      systemPrompt: ["[session: test_session]", "You are a test assistant."],
      agent: "build",
    })

    await Effect.runPromise(
      Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, data }),
    )

    const dir = Checkpoint.checkpointDir(sid)
    const slots = fs.readdirSync(dir).filter((f) => f.includes(sid) && f.endsWith(".enc"))
    expect(slots.length).toBeGreaterThanOrEqual(1)

    const loaded = await Effect.runPromise(
      Checkpoint.load({ sessionID: sid, providerID, modelID, projectID: TEST_PROJECT, agentName: "build" }),
    )

    expect(loaded).not.toBeNull()
    expect(loaded!.systemPrompt).toEqual(data.systemPrompt)
    expect(loaded!.identityFingerprint).toBe(data.identityFingerprint)
    expect(loaded!.messages).toEqual(data.messages)
    expect(loaded!.agent).toBe("build")
    expect(loaded!.turn).toBe(3)
    await Effect.runPromise(Checkpoint.remove(sid))
  })

  test("identityFingerprint is stable for identical identity bytes", () => {
    const a = Checkpoint.identityFingerprint("reasoning\nagent")
    const b = Checkpoint.identityFingerprint("reasoning\nagent")
    const c = Checkpoint.identityFingerprint("reasoning\nagent-changed")
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toHaveLength(64)
  })

  test("isIdentityCompatible rejects fingerprint mismatch and missing field", () => {
    const identity = "kernel-v1\nbuild"
    const data = makeCheckpointData({
      systemPrompt: [identity, "skills"],
      identityFingerprint: Checkpoint.identityFingerprint(identity),
    })
    expect(Checkpoint.isIdentityCompatible(data, identity)).toBe(true)
    expect(Checkpoint.isIdentityCompatible(data, "kernel-v2\nbuild")).toBe(false)
    expect(
      Checkpoint.isIdentityCompatible(
        { ...data, identityFingerprint: "" },
        identity,
      ),
    ).toBe(false)
  })

  test("load rejects v3 checkpoints without identityFingerprint", async () => {
    const sid = `${SID}_v3`
    const providerID = "v3-provider"
    const modelID = "v3-model"
    // Write a v3-shaped payload by saving then corrupting the version field via re-save path is hard
    // because save always writes v4. Simulate load rejection by saving with wrong version through
    // the public type (cast) is not allowed; instead verify tryLoad rejects empty fingerprint.
    const data = makeCheckpointData({
      model: { providerID, modelID },
      agent: "build",
      identityFingerprint: "",
    })
    // Direct save still encrypts — empty fingerprint fails load validation
    await Effect.runPromise(Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, data }))
    const loaded = await Effect.runPromise(
      Checkpoint.load({ sessionID: sid, providerID, modelID, projectID: TEST_PROJECT, agentName: "build" }),
    )
    expect(loaded).toBeNull()
    await Effect.runPromise(Checkpoint.remove(sid))
  })

  test("checkpoint with wrong project key returns null and cleans up", async () => {
    const sid = `${SID}_h`
    const providerID = "key-provider"
    const modelID = "key-model"
    const data = makeCheckpointData({ model: { providerID, modelID }, agent: "build" })

    await Effect.runPromise(
      Checkpoint.save({ sessionID: sid, projectID: TEST_PROJECT, data }),
    )

    const dir = Checkpoint.checkpointDir(sid)
    const before = fs.readdirSync(dir).filter((f) => f.includes(sid) && f.endsWith(".enc"))
    expect(before.length).toBeGreaterThanOrEqual(1)

    Checkpoint.dropMemory(sid)

    const loaded = await Effect.runPromise(
      Checkpoint.load({
        sessionID: sid,
        providerID,
        modelID,
        projectID: `${TEST_PROJECT}-other`,
        agentName: "build",
      }),
    )

    expect(loaded).toBeNull()
    const after = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.includes(sid) && f.endsWith(".enc"))
      : []
    expect(after.length).toBe(0)
  })

  test("publish makes load return data before disk settle", async () => {
    const sid = `${SID}_mem`
    const data = makeCheckpointData({
      model: { providerID: "mem", modelID: "mem-model" },
      agent: "build",
      turn: 9,
    })
    Checkpoint.publish({ sessionID: sid, data })
    const loaded = await Effect.runPromise(
      Checkpoint.load({
        sessionID: sid,
        providerID: "mem",
        modelID: "mem-model",
        projectID: TEST_PROJECT,
        agentName: "build",
      }),
    )
    expect(loaded).not.toBeNull()
    expect(loaded!.turn).toBe(9)
    await Effect.runPromise(Checkpoint.remove(sid))
  })

  test("reusablePrefixLength reuses matching ordered message IDs", () => {
    const data = makeCheckpointData({
      messageIDs: ["a", "b", "c"],
      messages: [
        { role: "user", content: "1" },
        { role: "assistant", content: "2" },
        { role: "user", content: "3" },
      ],
    })
    const msgs = [
      { info: { id: "a" }, parts: [] },
      { info: { id: "b" }, parts: [] },
      { info: { id: "c" }, parts: [] },
    ] as any
    expect(Checkpoint.reusablePrefixLength(msgs, data)).toBe(3)
  })

  test("reusablePrefixLength stops at the first different message ID", () => {
    const data = makeCheckpointData({
      messageIDs: ["a", "b"],
      messages: [
        { role: "user", content: "1" },
        { role: "assistant", content: "2" },
      ],
    })
    const msgs = [
      { info: { id: "a" }, parts: [] },
      { info: { id: "replacement" }, parts: [] },
    ] as any
    expect(Checkpoint.reusablePrefixLength(msgs, data)).toBe(1)
  })

  test("reusablePrefixLength is not capped by expanded model message count", () => {
    // Assistant with tools → assistant + tool-result (3 model msgs, 2 DB ids).
    // Old code used Math.min(..., data.messages.length) which was fine when
    // messages.length >= ids; the real bug was slice(0, prefixLen) on messages.
    const data = makeCheckpointData({
      messageIDs: ["user1", "asst1"],
      messages: [
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call_1", toolName: "bash", input: {} }],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call_1", toolName: "bash", output: { type: "text", value: "ok" } }],
        },
      ] as any,
      modelMessageCounts: [1, 2],
    })
    const msgs = [
      { info: { id: "user1" }, parts: [] },
      { info: { id: "asst1" }, parts: [] },
    ] as any
    expect(Checkpoint.reusablePrefixLength(msgs, data)).toBe(2)
  })

  test("takeModelPrefix includes tool-result messages after assistant tool-call", () => {
    const data = makeCheckpointData({
      messageIDs: ["user1", "asst1"],
      messages: [
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "running" },
            { type: "tool-call", toolCallId: "call_00_GQlJ", toolName: "bash", input: { command: "x" } },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_00_GQlJ",
              toolName: "bash",
              output: { type: "text", value: "done" },
            },
          ],
        },
      ] as any,
      modelMessageCounts: [1, 2],
    })

    // BUG reproduction: slice(0, prefixLen=2) drops the tool result (index 2).
    const wrong = data.messages.slice(0, 2)
    expect(wrong.some((m) => m.role === "tool")).toBe(false)

    const prefix = Checkpoint.takeModelPrefix(data, 2)
    expect(prefix).not.toBeNull()
    expect(prefix!.length).toBe(3)
    expect(prefix!.some((m) => m.role === "tool")).toBe(true)
    expect(Checkpoint.modelMessageEnd(data, 1)).toBe(1)
    expect(Checkpoint.modelMessageEnd(data, 2)).toBe(3)
    expect(Checkpoint.modelMessageEnd(data, 0)).toBe(0)
  })

  test("takeModelPrefix returns null without modelMessageCounts (legacy fallback)", () => {
    const data = makeCheckpointData({
      messageIDs: ["a", "b"],
      messages: [
        { role: "user", content: "1" },
        { role: "assistant", content: "2" },
      ],
    })
    expect(Checkpoint.takeModelPrefix(data, 2)).toBeNull()
    expect(Checkpoint.modelMessageEnd(data, 2)).toBeNull()
  })
})
