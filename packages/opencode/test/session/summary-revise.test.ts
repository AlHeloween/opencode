import { test, expect, afterEach } from "bun:test"
import { Effect } from "effect"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { IncrementalCheckpoint } from "../../src/session/incremental-checkpoint"
import { Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Truncate } from "@/tool/truncate"
import { revisionPath, SummaryEditTool } from "../../src/tool/summaryedit"
import { Session as SessionNs } from "@/session/session"
import { MessageID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"

/**
 * A summary has two halves with different standing. The body is Inferred — a
 * model's account, correctable before it folds into m* and is inherited by
 * every later turn. The rest is structure: from/to links, diffs, impact, all
 * `Exact — system-computed, not model output`.
 *
 * The whole guarantee of `summaryedit` is that the second half survives the
 * first being rewritten, so that is what these tests hold.
 */
function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

afterEach(async () => {
  await Instance.disposeAll()
})

test("revising the body leaves every structural field untouched", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Effect.runPromise(
        provideInstance(tmp.path)(
          Effect.gen(function* () {
            // A real session: ProjectCheckpointTable has an FK on session_id,
            // so a literal id inserts nothing (SQLITE_CONSTRAINT_FOREIGNKEY).
            const info = yield* (yield* SessionNs.Service).create({})
            const saved = IncrementalCheckpoint.save({
              id: "ckpt_revise_1",
              sessionID: info.id,
              fromMessageID: MessageID.make("msg_from"),
              toMessageID: MessageID.make("msg_to"),
              predecessorID: "ckpt_prior",
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: "build_mode",
              body: "the fix did not work",
              diffs: [{ file: "a.ts", additions: 3, deletions: 1, status: "modified" }] as never,
            })

            const previous = IncrementalCheckpoint.reviseBody({
              sessionID: info.id,
              id: saved.id,
              body: "the fix worked; the oracle was pointed at the wrong layer",
            })
            expect(previous).toBe("the fix did not work")

            const after = IncrementalCheckpoint.listAll(info.id).find((s) => s.id === saved.id)!
            expect(after.body).toContain("wrong layer")
            // Structure: identical, field by field. A `set` that ever widened
            // past `body` would show up right here.
            expect(after.fromMessageID).toBe(saved.fromMessageID)
            expect(after.toMessageID).toBe(saved.toMessageID)
            expect(after.predecessorID).toBe(saved.predecessorID)
            expect(after.providerID).toBe(saved.providerID)
            expect(after.modelID).toBe(saved.modelID)
            expect(after.timeCreated).toBe(saved.timeCreated)
            expect(after.diffs).toEqual(saved.diffs)
          }).pipe(Effect.provide(SessionNs.defaultLayer)),
        ),
      )
    },
  })
})

test("revising an id that is not in this session changes nothing", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Effect.runPromise(
        provideInstance(tmp.path)(
          Effect.gen(function* () {
            const info = { id: SessionID.make("ses_revise_missing") }
            // undefined, not a silent no-op that reports success: the caller
            // needs to know the id was wrong rather than assume it corrected
            // something.
            expect(
              IncrementalCheckpoint.reviseBody({ sessionID: info.id, id: "ckpt_nope", body: "x" }),
            ).toBeUndefined()
          }),
        ),
      )
    },
  })
})

test("the revision path is per-summary and time-ordered", () => {
  // Two corrections to the same summary must not overwrite each other, and the
  // filenames must sort oldest-first like memory's revisions do.
  const first = revisionPath("ckpt_a", new Date("2026-09-16T05:00:00.000Z"))
  const second = revisionPath("ckpt_a", new Date("2026-09-16T06:00:00.000Z"))
  expect(first).not.toBe(second)
  expect(first < second).toBe(true)
  expect(first).toContain("ckpt_a")
  expect(first).not.toContain(":")
})

test("subagents cannot rewrite the record of what happened", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await load(tmp.path, (svc) => svc.list())
      for (const name of ["explorer_agent", "researcher_agent", "general_agent", "coder_agent", "media_agent"]) {
        const agent = agents.find((a) => a.name === name)!
        expect(Permission.evaluate("summaryedit", "*", agent.permission).action).toBe("deny")
      }
      for (const name of ["build_mode", "plan_mode", "orchestrator_agent"]) {
        const agent = agents.find((a) => a.name === name)!
        expect(Permission.evaluate("summaryedit", "*", agent.permission).action).not.toBe("deny")
      }
    },
  })
})

test("an empty sessionId means THIS session, not a session with no name", async () => {
  // Measured 2026-09-21: two summaryedit calls carried `sessionId=` and both answered
  // «No summary `…` in session ``» for a summary open in the very session that asked. `??` does
  // not catch an empty string, and a present-but-empty optional field is the ordinary shape of a
  // model-filled argument — so an omitted session and an empty one must mean the same thing.
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const ids = await Effect.runPromise(
        provideInstance(tmp.path)(
          Effect.gen(function* () {
            const info = yield* (yield* SessionNs.Service).create({})
            const saved = IncrementalCheckpoint.save({
              id: "ckpt_empty_session",
              sessionID: info.id,
              fromMessageID: MessageID.make("msg_from"),
              toMessageID: MessageID.make("msg_to"),
              predecessorID: "ckpt_prior",
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
              agent: "build_mode",
              body: "the body this session owns",
              diffs: [] as never,
            })
            return { session: info.id as string, checkpoint: saved.id }
          }).pipe(Effect.provide(SessionNs.defaultLayer)),
        ),
      )

      const run = (params: Record<string, unknown>) =>
        Effect.runPromise(
          provideInstance(tmp.path)(
            Effect.gen(function* () {
              const tool = yield* (yield* SummaryEditTool).init()
              return yield* tool.execute(params as never, {
                sessionID: SessionID.make(ids.session),
                messageID: MessageID.make(""),
                callID: "",
                agent: "build_mode",
                abort: AbortSignal.any([]),
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              } as never)
            }).pipe(Effect.provide(Layer.mergeAll(AppFileSystem.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer))),
          ),
        )

      const read = (await run({ id: ids.checkpoint, sessionId: "", action: "read" })) as { output: string }
      expect(read.output).toContain("the body this session owns")

      // Whitespace is the same absence, and a genuinely unknown id now names the session that was
      // searched — a stale id must not be reported as a broken tool.
      await expect(run({ id: "ckpt_nope", sessionId: "   ", action: "read" })).rejects.toThrow(
        new RegExp(`No summary .* in session .*${ids.session}`),
      )
    },
  })
})

test("another session's summary is readable but not writable", async () => {
  // Consulting someone else's record is research; rewriting it is forging a
  // record you were not present for. The guard runs on the resolved target
  // BEFORE the row is read, so a write can never reach a row it does not own.
  await using tmp = await tmpdir()
  const other = SessionID.make("ses_someone_else")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const run = (params: Record<string, unknown>, current: string) =>
        Effect.runPromise(
          provideInstance(tmp.path)(
            Effect.gen(function* () {
              const tool = yield* (yield* SummaryEditTool).init()
              return yield* tool.execute(params as never, {
                sessionID: SessionID.make(current),
                messageID: MessageID.make(""),
                callID: "",
                agent: "build_mode",
                abort: AbortSignal.any([]),
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              } as never)
            }).pipe(Effect.provide(Layer.mergeAll(AppFileSystem.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer))),
          ),
        )

      const write = run({ id: "ckpt_x", sessionId: other, action: "write", body: "rewritten" }, "ses_mine")
      await expect(write).rejects.toThrow(/not this session/)

      // And the refusal is about ownership, not about the row being missing:
      // the same call as a read gets past the guard and fails on the lookup.
      const read = run({ id: "ckpt_x", sessionId: other, action: "read" }, "ses_mine")
      await expect(read).rejects.toThrow(/No summary/)
    },
  })
})
