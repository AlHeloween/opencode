import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session/session"
import { SessionSummary } from "../../src/session/summary"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Snapshot } from "../../src/snapshot"
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
 * Critical Exact contract for summary fossil endpoints.
 * Pure functions — no Fossil binary required.
 */
describe("SessionSummary.snapshotRangeForMessages (fossil Exact contract)", () => {
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

  test("no hash in range → skip even when prior exists", () => {
    const prior = [mk("msg_p", [{ type: "step-finish", snapshot: "H_prior" }])]
    const range = [mk("msg_r", [{ type: "text", text: "hello only" }], "user")]
    expect(SessionSummary.snapshotRangeForMessages(range, prior)).toBeUndefined()
  })

  test("prior hash + last hash in multi-hash range → full WC span for CodeGraph", () => {
    const prior = [mk("msg_p", [{ type: "step-finish", snapshot: "H_prior" }])]
    const range = [
      mk("msg_1", [{ type: "step-start", snapshot: "H1" }]),
      mk("msg_2", [
        { type: "step-finish", snapshot: "H2" },
        { type: "patch", hash: "H3", files: ["a.ts"] },
      ]),
      mk("msg_3", [{ type: "step-finish", snapshot: "H_last" }]),
    ]
    // Multiple changes in summary window: from = prior, to = LAST in range (not H1/H2).
    expect(SessionSummary.snapshotRangeForMessages(range, prior)).toEqual({
      from: "H_prior",
      to: "H_last",
    })
  })

  test("no prior: first hash in range is baseline, last is end", () => {
    const range = [
      mk("msg_1", [{ type: "step-start", snapshot: "H_open" }]),
      mk("msg_2", [{ type: "step-finish", snapshot: "H_mid" }]),
      mk("msg_3", [{ type: "patch", hash: "H_end", files: ["b.ts"] }]),
    ]
    expect(SessionSummary.snapshotRangeForMessages(range)).toEqual({
      from: "H_open",
      to: "H_end",
    })
    expect(SessionSummary.snapshotRangeForMessages(range, [])).toEqual({
      from: "H_open",
      to: "H_end",
    })
  })

  test("single hash in range, no prior → from === to (empty fossil span is valid)", () => {
    const range = [mk("msg_1", [{ type: "step-finish", snapshot: "H_only" }])]
    expect(SessionSummary.snapshotRangeForMessages(range)).toEqual({
      from: "H_only",
      to: "H_only",
    })
  })

  test("prior wins over first-in-range when both exist", () => {
    const prior = [mk("msg_p", [{ type: "step-finish", snapshot: "H0" }])]
    const range = [
      mk("msg_1", [{ type: "step-start", snapshot: "H1" }]),
      mk("msg_2", [{ type: "step-finish", snapshot: "H2" }]),
    ]
    expect(SessionSummary.snapshotRangeForMessages(range, prior)).toEqual({
      from: "H0",
      to: "H2",
    })
  })

  test("empty range messages → skip", () => {
    expect(SessionSummary.snapshotRangeForMessages([])).toBeUndefined()
    expect(
      SessionSummary.snapshotRangeForMessages([], [mk("msg_p", [{ type: "step-finish", snapshot: "H0" }])]),
    ).toBeUndefined()
  })
})

describe("SessionSummary.summarize structural handles", () => {
  function layer(impact: Snapshot.Interface["impact"]) {
    const snapshot = Layer.succeed(
      Snapshot.Service,
      Snapshot.Service.of({
        init: () => Effect.void,
        cleanup: () => Effect.void,
        track: () => Effect.succeed(undefined),
        checkpoint: () => Effect.succeed(undefined),
        checkout: () => Effect.void,
        opId: () => Effect.succeed(undefined),
        opRestore: () => Effect.void,
        patch: () => Effect.succeed({ hash: "", files: [] }),
        restore: () => Effect.void,
        revert: () => Effect.void,
        diff: () => Effect.succeed(""),
        diffFull: () => Effect.succeed([]),
        impact,
        lastImpact: () => Effect.die("unexpected lastImpact"),
      }),
    )
    return SessionSummary.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(SessionNs.defaultLayer, snapshot, Storage.defaultLayer, Bus.layer, CrossSpawnSpawner.defaultLayer),
      ),
    )
  }

  function setup(impact: Snapshot.Interface["impact"]) {
    return provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* SessionNs.Service
        const info = yield* sessions.create({})
        const rangeUser = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: 1 },
        })
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: rangeUser.id,
          sessionID: info.id,
          type: "step-start",
          snapshot: "fossil_from",
        })
        const rangeAssistant = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: info.id,
          parentID: rangeUser.id,
          agent: "build",
          modelID: ref.modelID,
          providerID: ref.providerID,
          path: { cwd: dir, root: dir },
          cost: 0,
          mode: "build",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 2 },
        } as MessageV2.Assistant)
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: rangeAssistant.id,
          sessionID: info.id,
          type: "step-finish",
          reason: "end_turn",
          snapshot: "fossil_to",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        const summaryRequest = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: 3 },
        })
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: summaryRequest.id,
          sessionID: info.id,
          type: "text",
          text: `<!-- summary-range from_id="${rangeUser.id}" to_id="${rangeAssistant.id}" session_id="${info.id}" -->`,
          synthetic: true,
          ignored: true,
        })
        const summary = yield* SessionSummary.Service
        yield* summary.summarize({ sessionID: info.id, messageID: summaryRequest.id })
        const messages = yield* sessions.messages({ sessionID: info.id, limit: 20 })
        return messages.find((message) => message.info.id === summaryRequest.id)!
      }),
    ).pipe(Effect.provide(layer(impact)), Effect.provide(CrossSpawnSpawner.defaultLayer))
  }

  test("attaches the range impact computed by Snapshot.impact", async () => {
    const calls: Array<[string, string]> = []
    const message = await Effect.runPromise(Effect.scoped(
      setup((from, to) => {
        calls.push([from, to])
        return Effect.succeed({
          from,
          to,
          changedFiles: 2,
          symbolCountByKind: { function: 3 },
          topSymbols: ["compact"],
          impactedFiles: ["src/session/compaction.ts"],
          callerCount: 4,
        })
      }),
    ))
    expect(calls).toEqual([["fossil_from", "fossil_to"]])
    const summary = message.info.role === "user" ? message.info.summary : undefined
    expect(summary?.impact?.topSymbols).toEqual(["compact"])
  })

  test("omits an unavailable structural handle instead of inventing one", async () => {
    const message = await Effect.runPromise(Effect.scoped(setup(() => Effect.die("CodeGraph index unavailable"))))
    const summary = message.info.role === "user" ? message.info.summary : undefined
    expect(summary?.impact).toBeUndefined()
    expect(summary?.diffs).toEqual([])
  })
})

describe("SessionSummary.update", () => {
  test("recomputes only files reported by each write step", async () => {
    const calls: Array<{ from: string; to: string; files: readonly string[] | undefined }> = []
    const snapshot = Layer.succeed(
      Snapshot.Service,
      Snapshot.Service.of({
        init: () => Effect.void,
        cleanup: () => Effect.void,
        track: () => Effect.succeed(undefined),
        checkpoint: () => Effect.succeed(undefined),
        checkout: () => Effect.void,
        opId: () => Effect.succeed(undefined),
        opRestore: () => Effect.void,
        patch: () => Effect.succeed({ hash: "", files: [] }),
        restore: () => Effect.void,
        revert: () => Effect.void,
        diff: () => Effect.succeed(""),
        diffFull: (from, to, files) =>
          Effect.sync(() => {
            calls.push({ from, to, files })
            return (files ?? []).map((file) => ({
              file,
              patch: "",
              additions: to === "after_b" ? 2 : 1,
              deletions: 0,
              status: "modified" as const,
            }))
          }),
        impact: () => Effect.die("unexpected impact"),
        lastImpact: () => Effect.die("unexpected lastImpact"),
      }),
    )
    const layer = SessionSummary.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(SessionNs.defaultLayer, snapshot, Storage.defaultLayer, Bus.layer, CrossSpawnSpawner.defaultLayer),
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
            yield* summary.update({
              sessionID: info.id,
              messageID: user.id,
              before: "base",
              after: "after_a",
              files: [path.join(dir, "a.ts")],
            })
            yield* summary.update({
              sessionID: info.id,
              messageID: user.id,
              before: "after_a",
              after: "after_b",
              files: [path.join(dir, "b.ts")],
            })
            const diff = yield* summary.diff({ sessionID: info.id })
            expect(diff.map((item) => path.basename(item.file)).sort()).toEqual(["a.ts", "b.ts"])
          }),
        ).pipe(Effect.provide(layer)),
      ),
    )

    expect(calls).toHaveLength(3)
    expect(calls.every((call) => call.files?.length)).toBe(true)
    expect(calls[0]?.files?.map((file) => path.basename(file))).toEqual(["a.ts"])
    expect(calls[1]?.files?.map((file) => path.basename(file))).toEqual(["b.ts"])
    expect(calls[2]?.files?.map((file) => path.basename(file)).sort()).toEqual(["a.ts", "b.ts"])
  })
})
