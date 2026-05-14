import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { SessionSummary } from "../../src/session/summary"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"
import path from "path"

const sid = SessionID.make("test-session")
const mid = MessageID.make("")
const pid = PartID.make("")
const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test") }

function fileDiff(file: string, additions: number, deletions: number): MessageV2.ToolPart {
  return {
    id: pid,
    callID: "call_1",
    tool: "edit",
    type: "tool" as const,
    state: {
      status: "completed",
      output: "",
      time: { start: 0, end: 1 },
      input: {},
      metadata: {},
      title: "",
    },
    metadata: { filediff: { file, patch: "", additions, deletions } },
    sessionID: sid,
    messageID: mid,
  }
}

function makeParts(
  diffs: { file: string; additions: number; deletions: number }[],
): MessageV2.WithParts[] {
  const userParts: MessageV2.Part[] = [
    { id: pid, type: "text", text: "test", sessionID: sid, messageID: mid },
  ]
  const toolParts: MessageV2.Part[] = diffs.map((d) => fileDiff(d.file, d.additions, d.deletions))

  return [
    {
      info: {
        id: mid,
        sessionID: sid,
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: ref,
      },
      parts: userParts,
    },
    {
      info: {
        id: mid,
        sessionID: sid,
        role: "assistant",
        parentID: mid,
        time: { created: 2, completed: 2 },
        agent: "build",
        modelID: ref.modelID,
        providerID: ref.providerID,
        cost: 0,
        mode: "primary",
        path: { cwd: "/", root: "/" },
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: toolParts,
    },
  ]
}

describe("SessionSummary.computeDiff", () => {
  test("aggregates filediffs from tool parts when snapshots are missing", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Effect.runPromise(
          SessionSummary.Service.use((svc) =>
            svc.computeDiff({
              messages: makeParts([
                { file: path.join(tmp.path, "a.ts"), additions: 5, deletions: 2 },
                { file: path.join(tmp.path, "b.ts"), additions: 0, deletions: 3 },
              ]),
            }),
          ).pipe(Effect.provide(SessionSummary.defaultLayer)),
        )

        expect(result.length).toBe(2)
        const a = result.find((d) => d.file.endsWith("a.ts"))
        expect(a).toBeDefined()
        expect(a!.additions).toBe(5)
        expect(a!.deletions).toBe(2)
        const b = result.find((d) => d.file.endsWith("b.ts"))
        expect(b).toBeDefined()
        expect(b!.additions).toBe(0)
        expect(b!.deletions).toBe(3)
      },
    })
  })

  test("returns latest filediff per file when multiple edits target same file", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Effect.runPromise(
          SessionSummary.Service.use((svc) =>
            svc.computeDiff({
              messages: makeParts([
                { file: path.join(tmp.path, "x.ts"), additions: 1, deletions: 0 },
                { file: path.join(tmp.path, "x.ts"), additions: 3, deletions: 1 },
              ]),
            }),
          ).pipe(Effect.provide(SessionSummary.defaultLayer)),
        )

        expect(result.length).toBe(1)
        expect(result[0].additions).toBe(3)
        expect(result[0].deletions).toBe(1)
      },
    })
  })

  test("skips timestamp-only files (no additions or deletions)", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Effect.runPromise(
          SessionSummary.Service.use((svc) =>
            svc.computeDiff({
              messages: makeParts([
                { file: path.join(tmp.path, "changed.ts"), additions: 5, deletions: 0 },
                { file: path.join(tmp.path, "touched.ts"), additions: 0, deletions: 0 },
              ]),
            }),
          ).pipe(Effect.provide(SessionSummary.defaultLayer)),
        )

        expect(result.length).toBe(1)
        expect(result[0].file.endsWith("changed.ts")).toBe(true)
      },
    })
  })

  test("returns empty array when no tool parts have filediff metadata", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Effect.runPromise(
          SessionSummary.Service.use((svc) =>
            svc.computeDiff({
              messages: [
                {
                  info: {
                    id: mid,
                    sessionID: sid,
                    role: "user",
                    time: { created: 1 },
                    agent: "build",
                    model: ref,
                  },
                  parts: [
                    {
                      id: pid,
                      type: "text",
                      text: "no metadata here",
                      sessionID: sid,
                      messageID: mid,
                    },
                  ],
                },
              ],
            }),
          ).pipe(Effect.provide(SessionSummary.defaultLayer)),
        )

        expect(result.length).toBe(0)
      },
    })
  })
})
