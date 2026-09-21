import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session/session"
import { SessionSummary } from "../../src/session/summary"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Storage } from "../../src/storage/storage"
import { provideTmpdirInstance, tmpdir } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
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
      metadata: { filediff: { file, patch: "", additions, deletions } },
      title: "",
    },
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
  }, 15_000)

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
  }, 15_000)

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

describe("SessionSummary.pruneGhostFileDiffs", () => {
  test("drops missing paths (deleted after write / cleaned foreign absolutes)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const alive = path.join(tmp.path, "alive.ts")
        await Bun.write(alive, "ok\n")
        const ghost = path.join(tmp.path, "gone.ts")
        const foreign = "C:\\Users\\ghost\\Documents\\opencode\\x.txt"
        const kept = SessionSummary.pruneGhostFileDiffs([
          { file: alive, patch: "", additions: 1, deletions: 0 },
          { file: ghost, patch: "", additions: 2, deletions: 0 },
          { file: foreign, patch: "", additions: 3, deletions: 0 },
        ])
        expect(kept.map((d) => d.file)).toEqual([alive])
      },
    })
  })
})

describe("SessionSummary.parseSummaryRange / sliceMessagesForSummaryRange", () => {
  test("parses from_id and to_id from synthetic summary-range text", () => {
    const text = `<!-- summary-range from_id="msg_aaa" to_id="msg_zzz" session_id="ses_1" -->
Create a structured summary of the conversation from message \`msg_aaa\` to \`msg_zzz\`.`
    expect(SessionSummary.parseSummaryRange(text)).toEqual({
      fromId: "msg_aaa",
      toId: "msg_zzz",
    })
  })

  test("returns undefined for ordinary user text", () => {
    expect(SessionSummary.parseSummaryRange("please fix the bug")).toBeUndefined()
  })

  test("slices inclusive range by ascending message id", () => {
    const mk = (id: string): MessageV2.WithParts =>
      ({
        info: { id: MessageID.make(id), role: "user", sessionID: sid, time: { created: 1 }, agent: "build", model: ref },
        parts: [],
      }) as any
    const all = [mk("msg_a"), mk("msg_b"), mk("msg_c"), mk("msg_d")]
    const sliced = SessionSummary.sliceMessagesForSummaryRange(all, "msg_b", "msg_c")
    expect(sliced.map((m) => m.info.id)).toEqual([MessageID.make("msg_b"), MessageID.make("msg_c")])
  })

  test("Layer-1 summary turn has no edits but range messages do — range computeDiff is non-empty", async () => {
    // Documents the bug: summarizing only the summary-range parent + summary
    // assistant yields [] diffs; the open window's tool filediffs must be used.
    await using tmp = await tmpdir({ git: true })

    const idA = MessageID.make("msg_range_a")
    const idB = MessageID.make("msg_range_b")
    const idReq = MessageID.make("msg_summary_req")
    const idSum = MessageID.make("msg_summary_asst")

    const rangeWork: MessageV2.WithParts[] = [
      {
        info: {
          id: idA,
          sessionID: sid,
          role: "user",
          time: { created: 1 },
          agent: "build",
          model: ref,
        },
        parts: [{ id: pid, type: "text", text: "edit files", sessionID: sid, messageID: idA }],
      },
      {
        info: {
          id: idB,
          sessionID: sid,
          role: "assistant",
          parentID: idA,
          time: { created: 2, completed: 2 },
          agent: "build",
          modelID: ref.modelID,
          providerID: ref.providerID,
          cost: 0,
          mode: "primary",
          path: { cwd: "/", root: "/" },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [fileDiff(path.join(tmp.path, "work.ts"), 10, 2)].map((p) => ({
          ...p,
          messageID: idB,
        })),
      },
    ]

    const summaryTurn: MessageV2.WithParts[] = [
      {
        info: {
          id: idReq,
          sessionID: sid,
          role: "user",
          time: { created: 3 },
          agent: "build",
          model: ref,
        },
        parts: [
          {
            id: pid,
            type: "text",
            text: `<!-- summary-range from_id="${idA}" to_id="${idB}" session_id="${sid}" -->\nCreate a structured summary`,
            sessionID: sid,
            messageID: idReq,
            synthetic: true,
          },
        ],
      },
      {
        info: {
          id: idSum,
          sessionID: sid,
          role: "assistant",
          parentID: idReq,
          summary: true,
          time: { created: 4, completed: 4 },
          agent: "build",
          modelID: ref.modelID,
          providerID: ref.providerID,
          cost: 0,
          mode: "primary",
          path: { cwd: "/", root: "/" },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [
          {
            id: pid,
            type: "text",
            text: "## Semantic Vector\ndominant: \"test\"\n\n## Goal\n- done",
            sessionID: sid,
            messageID: idSum,
          },
        ],
      },
    ]

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const turnOnly = await Effect.runPromise(
          SessionSummary.Service.use((svc) => svc.computeDiff({ messages: summaryTurn })).pipe(
            Effect.provide(SessionSummary.defaultLayer),
          ),
        )
        expect(turnOnly.length).toBe(0)

        const range = SessionSummary.parseSummaryRange((summaryTurn[0].parts[0] as any).text)!
        const sliced = SessionSummary.sliceMessagesForSummaryRange(
          [...rangeWork, ...summaryTurn],
          range.fromId,
          range.toId,
        )
        const rangeDiffs = await Effect.runPromise(
          SessionSummary.Service.use((svc) => svc.computeDiff({ messages: sliced })).pipe(
            Effect.provide(SessionSummary.defaultLayer),
          ),
        )
        expect(rangeDiffs.length).toBe(1)
        expect(rangeDiffs[0].file.endsWith("work.ts")).toBe(true)
        expect(rangeDiffs[0].additions).toBe(10)
      },
    })
  })
})

/**
 * Summary-range anchors. These are the SAME hashes the undo/redo chain stores, so a
 * range diff is derived from them (anchors first, tool metadata merged — the live
 * path is pinned in summary-anchors.test.ts).
 */
describe("SessionSummary summary-range anchors", () => {
  const mk = (
    id: string,
    parts: Array<Record<string, unknown>>,
    role: "user" | "assistant" = "assistant",
  ): MessageV2.WithParts =>
    ({
      info: {
        id: MessageID.make(id),
        role,
        sessionID: sid,
        time: { created: 1 },
        agent: "build",
        model: ref,
      },
      parts,
    }) as MessageV2.WithParts

  test("snapshotHashesOnMessage collects step-start, step-finish, and patch", () => {
    const msg = mk("msg_h", [
      { type: "step-start", snapshot: "H0" },
      { type: "text", text: "x" },
      { type: "step-finish", snapshot: "H1" },
      { type: "patch", hash: "H2", files: ["a.ts"] },
    ])
    expect(SessionSummary.snapshotHashesOnMessage(msg)).toEqual(["H0", "H1", "H2"])
  })

  test("the first anchored message in the range is the start", () => {
    const range = [
      mk("msg_1", [{ type: "step-start", snapshot: "H1" }]),
      mk("msg_2", [
        { type: "step-finish", snapshot: "H2" },
        { type: "patch", hash: "H3", files: ["a.ts"] },
      ]),
      mk("msg_3", [{ type: "step-finish", snapshot: "H_last" }]),
    ]
    expect(SessionSummary.summaryRangeStartHash(range)).toBe("H1")
    // Prior messages never move the start when the range carries its own anchor.
    const prior = [mk("msg_p", [{ type: "step-finish", snapshot: "H_prior" }])]
    expect(SessionSummary.summaryRangeStartHash(range, prior)).toBe("H1")
  })

  test("a range without anchors falls back to the last stored anchor before it", () => {
    const before = [
      mk("msg_p1", [{ type: "step-finish", snapshot: "H_old" }]),
      mk("msg_p2", [{ type: "step-finish", snapshot: "H_prior" }]),
    ]
    const range = [mk("msg_r", [{ type: "text", text: "hello only" }], "user")]
    expect(SessionSummary.summaryRangeStartHash(range, before)).toBe("H_prior")
  })

  test("no anchors anywhere is undefined", () => {
    expect(SessionSummary.summaryRangeStartHash([])).toBeUndefined()
    expect(SessionSummary.summaryRangeStartHash([mk("msg_r", [{ type: "text", text: "x" }])], [])).toBeUndefined()
  })
})

// Anchored summary diffs: summary-anchors.test.ts (live) + summary-exact-live.test.ts (tool fallback).

describe("SessionSummary.update / updateFallback (tool filediffs only)", () => {
  test("merges explicit tool filediffs without Fossil diffFull", async () => {
    const layer = SessionSummary.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(SessionNs.defaultLayer, Storage.defaultLayer, Bus.layer, CrossSpawnSpawner.defaultLayer),
      ),
    )

    await Effect.runPromise(
      Effect.scoped(
        provideTmpdirInstance((dir) =>
          Effect.gen(function* () {
            const sessions = yield* SessionNs.Service
            const info = yield* sessions.create({})
            const user = yield* sessions.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: info.id,
              agent: "build",
              model: ref,
              time: { created: 1 },
            })
            const summary = yield* SessionSummary.Service
            const a = path.join(dir, "a.ts")
            const b = path.join(dir, "b.ts")
            // session_diff list is reconciled to disk — ghosts (missing files) are pruned
            yield* Effect.promise(() => Bun.write(a, "a\n"))
            yield* Effect.promise(() => Bun.write(b, "b\n"))
            yield* summary.updateFallback({
              sessionID: info.id,
              messageID: user.id,
              diffs: [{ file: a, patch: "", additions: 1, deletions: 0, status: "modified" }],
            })
            yield* summary.updateFallback({
              sessionID: info.id,
              messageID: user.id,
              diffs: [{ file: b, patch: "", additions: 2, deletions: 0, status: "modified" }],
            })
            const diff = yield* summary.diff({ sessionID: info.id })
            expect(diff.map((item) => path.basename(item.file)).sort()).toEqual(["a.ts", "b.ts"])
            expect(diff.find((d) => d.file.endsWith("b.ts"))?.additions).toBe(2)
          }),
        ).pipe(Effect.provide(layer)),
      ),
    )
  })

  test("update reads tool filediffs from session DB (ignores fossil hashes)", async () => {
    const layer = SessionSummary.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(SessionNs.defaultLayer, Storage.defaultLayer, Bus.layer, CrossSpawnSpawner.defaultLayer),
      ),
    )

    await Effect.runPromise(
      Effect.scoped(
        provideTmpdirInstance((dir) =>
          Effect.gen(function* () {
            const sessions = yield* SessionNs.Service
            const info = yield* sessions.create({})
            const user = yield* sessions.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: info.id,
              agent: "build",
              model: ref,
              time: { created: 1 },
            })
            const assistant = yield* sessions.updateMessage({
              id: MessageID.ascending(),
              role: "assistant",
              sessionID: info.id,
              parentID: user.id,
              agent: "build",
              modelID: ref.modelID,
              providerID: ref.providerID,
              cost: 0,
              mode: "primary",
              path: { cwd: dir, root: dir },
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: 2 },
            })
            const a = path.join(dir, "a.ts")
            yield* Effect.promise(() => Bun.write(a, "x\n"))
            yield* sessions.updatePart({
              id: PartID.ascending(),
              sessionID: info.id,
              messageID: assistant.id,
              type: "tool",
              callID: "c1",
              tool: "edit",
              state: {
                status: "completed",
                input: {},
                output: "",
                title: "edit a",
                time: { start: 0, end: 1 },
                metadata: {
                  filediff: { file: a, patch: "", additions: 3, deletions: 1, status: "modified" },
                },
              },
            })
            const summary = yield* SessionSummary.Service
            yield* summary.update({
              sessionID: info.id,
              messageID: user.id,
              before: "ignored-fossil-from",
              after: "ignored-fossil-to",
              files: [a],
            })
            const diff = yield* summary.diff({ sessionID: info.id })
            expect(diff).toHaveLength(1)
            expect(diff[0]?.additions).toBe(3)
            expect(diff[0]?.deletions).toBe(1)
          }),
        ).pipe(Effect.provide(layer)),
      ),
    )
  })
})
