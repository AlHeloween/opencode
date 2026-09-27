/**
 * T4 — the mechanical WRITER, on the real layer and the real table.
 *
 * `mechanical-summary-body.test.ts` covers the body BUILDER (pure). This covers the WRITER, which is
 * where the owner's constraint actually lives: «никакого вызова модели в цикле». The body can be
 * right and the cycle still spend a request, so the writer needs its own instrument.
 *
 * What is asserted, and why each one can fail:
 *
 *  1. one call -> exactly one row, carrying the range's real tool filediffs. The diffs are the
 *     `metadata.filediff` a completed `edit` really leaves, read by the real `collectToolFileDiffs`
 *     — no stubbed enrichment, so a writer that stopped passing diffs through fails here.
 *  2. a SECOND call over the SAME range adds no row. `save` conflicts and returns the existing row,
 *     so the COUNT is the invariant — and it is the one the "19 panels" phantom was chasing by
 *     counting the wrong table. Asserting it makes the next duplicate a red test instead of a number
 *     somebody has to re-derive from prose.
 *  3. a one-message range writes nothing (the `from === to` guard).
 *  4. the module and the function carry no path to a request builder. That is the negative claim
 *     (`zero model requests`), and a negative claim needs a FAIL-CAPABLE instrument: a body that
 *     grew a `streamText` or an `LLM.` call has to break the build, or the constraint is prose.
 *
 * Each test owns its own session id. Sharing one would make the row counts depend on test ORDER,
 * which is the same class of fragility as the phantom count this file exists to prevent.
 *
 * CodeGraph `impact` is deliberately NOT asserted: `hasCodegraphIndex` reads the project path, and a
 * tmpdir instance has no `.codegraph`, so its presence is an environment fact and not a value. An
 * absence that depends on where the test runs must not be pinned as an expectation — the project's
 * own rule, applied to its own test.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session/session"
import { SessionSummary } from "../../src/session/summary"
import { IncrementalCheckpoint } from "../../src/session/incremental-checkpoint"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Storage } from "../../src/storage/storage"
import { provideTmpdirInstance } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test") }

const writerLayer = SessionSummary.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(SessionNs.defaultLayer, Storage.defaultLayer, Bus.layer, CrossSpawnSpawner.defaultLayer),
  ),
)

afterEach(async () => {
  await Instance.disposeAll()
  Bun.gc(true)
})

const EDIT_FILE = "src/session/writer-fixture.ts"

/** A completed `edit` part carrying the filediff metadata the real tool leaves behind. */
function editPart(sid: SessionID, messageID: string): MessageV2.ToolPart {
  const patch = [
    "--- a/" + EDIT_FILE,
    "+++ b/" + EDIT_FILE,
    "@@ -1 +1,2 @@",
    " const A = 1",
    "+const B = 2",
  ].join("\n")
  return {
    id: PartID.make("part_writer"),
    callID: "call_writer",
    tool: "edit",
    type: "tool",
    state: {
      status: "completed",
      output: "ok",
      time: { start: 0, end: 1 },
      input: { filePath: EDIT_FILE, oldString: "const A = 1", newString: "const B = 2" },
      metadata: { filediff: { file: EDIT_FILE, patch, additions: 1, deletions: 0, status: "modified" }, diff: patch },
      title: path.basename(EDIT_FILE),
    },
    sessionID: sid,
    messageID,
  } as unknown as MessageV2.ToolPart
}

function turn(sid: SessionID, from: string, to: string, withEdit: boolean): MessageV2.WithParts[] {
  return [
    {
      info: { id: from, sessionID: sid, role: "user", time: { created: 1 } },
      parts: [{ id: PartID.make("p_" + from), sessionID: sid, messageID: from, type: "text", text: "work" }],
    },
    {
      info: {
        id: to,
        sessionID: sid,
        role: "assistant",
        mode: "build",
        agent: "build",
        parentID: from,
        modelID: ref.modelID,
        providerID: ref.providerID,
        cost: 0,
        tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "end_turn",
        time: { created: 2 },
      },
      parts: withEdit
        ? [editPart(sid, to)]
        : [{ id: PartID.make("p_" + to), sessionID: sid, messageID: to, type: "text", text: "done" }],
    },
  ] as unknown as MessageV2.WithParts[]
}

/**
 * Everything runs INSIDE the instance, reads included. Two measured constraints, both of which the
 * first version of this file got wrong:
 *
 *  - `db.ts` keeps the store in a LOCAL context, so `IncrementalCheckpoint.listAll` after the run
 *    returns throws «No context found for database».
 *  - `project_checkpoint.session_id` is a FOREIGN KEY, so the session row must exist before the
 *    writer runs. `enrichRange` alone needs none — and generalising from a test that only calls
 *    `enrichRange` is exactly how the FK failure was written in the first time.
 */
function run<A, E, R>(body: (dir: string) => Effect.Effect<A, E, R>) {
  const closed = Effect.scoped(provideTmpdirInstance(body).pipe(Effect.provide(writerLayer))) as Effect.Effect<A, E>
  return Effect.runPromise(closed)
}

describe("captureMechanical (the producer that owes no model call)", () => {
  test(
    "writes ONE row carrying the range's real tool filediffs",
    async () => {
      await run(() =>
        Effect.gen(function* () {
          const ssn = yield* SessionNs.Service
          const summary = yield* SessionSummary.Service
          const info = yield* ssn.create({})
          const from = MessageID.make("msg_writer_a")
          const to = MessageID.make("msg_writer_b")

          const row = yield* summary.captureMechanical({
            sessionID: info.id,
            messages: turn(info.id, from, to, true),
            providerID: ref.providerID,
            modelID: ref.modelID,
            agent: "build",
          })

          expect(row).toBeDefined()
          expect(row!.id).toStartWith("ckpt_")
          expect(row!.fromMessageID).toBe(from)
          expect(row!.toMessageID).toBe(to)
          // The diff is the point of `enrichRange`: with no snapshot anchor it is the tool metadata
          // alone, so a writer that stopped passing diffs through fails HERE and nowhere else.
          expect(row!.diffs!.length).toBe(1)
          expect(row!.diffs![0]!.file).toBe(EDIT_FILE)
          expect(row!.diffs![0]!.patch).toContain("const B = 2")
          expect(IncrementalCheckpoint.listAll(info.id)).toHaveLength(1)
        }),
      )
    },
    30_000,
  )

  test(
    "a SECOND call over the same range adds NO row — the count is the invariant",
    async () => {
      await run(() =>
        Effect.gen(function* () {
          const ssn = yield* SessionNs.Service
          const summary = yield* SessionSummary.Service
          const info = yield* ssn.create({})
          const from = MessageID.make("msg_writer_c")
          const to = MessageID.make("msg_writer_d")
          const args = {
            sessionID: info.id,
            messages: turn(info.id, from, to, true),
            providerID: ref.providerID,
            modelID: ref.modelID,
            agent: "build",
          }

          const first = yield* summary.captureMechanical(args)
          const second = yield* summary.captureMechanical(args)

          // `save` conflicts on (session, from, to, predecessor) and RETURNS the existing row, so this
          // is a same-id return and not a second insert. A writer that stopped deduping shows up here
          // as 2 rows — which is the number the "19 panels" phantom was guessing at out of prose.
          expect(first).toBeDefined()
          expect(second!.id).toBe(first!.id)
          expect(IncrementalCheckpoint.listAll(info.id)).toHaveLength(1)
        }),
      )
    },
    30_000,
  )

  test(
    "a one-message range writes nothing",
    async () => {
      await run(() =>
        Effect.gen(function* () {
          const ssn = yield* SessionNs.Service
          const summary = yield* SessionSummary.Service
          const info = yield* ssn.create({})
          const only = MessageID.make("msg_writer_e")
          const row = yield* summary.captureMechanical({
            sessionID: info.id,
            messages: turn(info.id, only, only, false),
            providerID: ref.providerID,
            modelID: ref.modelID,
            agent: "build",
          })
          expect(row).toBeUndefined()
          expect(IncrementalCheckpoint.listAll(info.id)).toHaveLength(0)
        }),
      )
    },
    30_000,
  )
})

describe("the no-model-call constraint has an instrument, not a promise", () => {
  const SRC = path.resolve(import.meta.dir, "../../src/session/summary.ts")

  test("summary.ts imports no request builder", () => {
    const imports = readFileSync(SRC, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("import "))
    // A direct import of either module is the cheapest way to spend a request from the writer, and
    // it is a one-line mistake to make and a one-line mistake to miss in review.
    expect(imports.filter((l) => /from\s+"[^"]*\/(llm|prompt)"$/.test(l))).toEqual([])
  })

  test("captureMechanical's own body calls no model", () => {
    const text = readFileSync(SRC, "utf8")
    const start = text.indexOf("const captureMechanical = Effect.fn(")
    const end = text.indexOf("return Service.of(", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    // The BODY is checked, not the comment above it: the comment claims «No provider is contacted»,
    // and a claim in prose is exactly what this session keeps refuting.
    expect(text.slice(start, end)).not.toMatch(/\b(streamText|streamObject|LLM\.|SessionPrompt\.|SessionProcessor\.)/)
  })
})
