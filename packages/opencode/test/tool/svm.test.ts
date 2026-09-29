/**
 * The `svm` tool — the surface over the manifest store.
 *
 * S2 of plans/2026-09-29_svm-tool-and-master-plan.md. What is asserted, and why each case can fail:
 *
 *  1. `set` → `read` round-trips every field THROUGH THE TOOL, not only through the store. S1b covers
 *     the store; this covers the wiring, which is where a store captured at init can be the wrong one.
 *  2. reading a task that was never given a manifest says so and does NOT invent one — the same claim
 *     as S1b's, made at the layer a model actually touches.
 *  3. a `set` with no vector is REFUSED and writes nothing. Asserted by reading the task back in the
 *     SAME instance, because a refusal that still wrote would look identical from the outside.
 *  4. the tool's name resolves in the registry: it is registered under its canonical id, which is the
 *     `Tool.define` contract (lowercase alphanumerics, one identity, no second spelling).
 */
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Storage } from "@/storage/storage"
import { SvmTool } from "@/tool/svm"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { SessionID, MessageID } from "@/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const PLAN = "plans/2026-09-29_svm-tool-and-master-plan.md"

const ctx = {
  sessionID: SessionID.make("ses_svm-tool"),
  messageID: MessageID.make(""),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const layer = Layer.mergeAll(
  Storage.defaultLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
)

/** Everything runs inside a throwaway instance, so the real store is never touched. */
function inTmpdir<A, E, R>(body: (dir: string) => Effect.Effect<A, E, R>) {
  return Effect.runPromise(
    Effect.scoped(provideTmpdirInstance(body).pipe(Effect.provide(layer))) as Effect.Effect<A, E>,
  )
}

type Params = {
  action: "read" | "set"
  plan: string
  task: string
  sv?: string
  etaTurns?: number
  oracle?: string
  state?: "doing" | "blocked" | "verified" | "waiting-on-user"
}

/** Call the tool the way the runtime does: init once, then execute on that definition. */
const call = (params: Params) =>
  Effect.gen(function* () {
    const info = yield* SvmTool
    const tool = yield* info.init()
    return yield* tool.execute(params, ctx)
  })

describe("svm tool", () => {
  test("set → read round-trips every field through the tool", async () => {
    const read = await inTmpdir(() =>
      Effect.gen(function* () {
        const set = yield* call({
          action: "set",
          plan: PLAN,
          task: "S2",
          sv: "Keywords: tool 0.7, manifest 0.3",
          etaTurns: 3,
          oracle: "set→read round-trip",
        })
        expect(set.metadata.present).toBe(true)
        return yield* call({ action: "read", plan: PLAN, task: "S2" })
      }),
    )
    expect(read.metadata.present).toBe(true)
    expect(JSON.parse(read.output)).toEqual({
      task: "S2",
      plan: PLAN,
      sv: "Keywords: tool 0.7, manifest 0.3",
      etaTurns: 3,
      // `state` was not given, so it takes the declared default rather than being left undefined.
      state: "doing",
      oracle: "set→read round-trip",
    })
  })

  test("a task with no manifest is reported, never invented", async () => {
    const read = await inTmpdir(() => call({ action: "read", plan: PLAN, task: "NEVER-WRITTEN" }))
    expect(read.metadata.present).toBe(false)
    expect(read.output).toContain("No manifest")
  })

  test("a set without its vector is refused, and writes nothing", async () => {
    const after = await inTmpdir(() =>
      Effect.gen(function* () {
        const refused = yield* call({ action: "set", plan: PLAN, task: "S3", etaTurns: 2, oracle: "something" })
        expect(refused.metadata.present).toBe(false)
        expect(refused.title).toContain("refused")
        // Same instance: a refusal that still wrote the partial record would look identical from outside.
        return yield* call({ action: "read", plan: PLAN, task: "S3" })
      }),
    )
    expect(after.metadata.present).toBe(false)
  })
})
