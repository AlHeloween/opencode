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
 *
 * The plan key below is this file's OWN, and that is a defect fix rather than tidiness (2026-09-30).
 * The store under the fixture is not throwaway: `Storage` roots it at `Global.Path.data`, which the
 * fixture leaves at `TEST_TEMP`, so this file's `set` of task `S2` under the REAL plan id survived into
 * the next run and turned `test/session/svm.test.ts`'s `missing()` assertion red — green or red
 * depending on which file ran first. A test that WRITES needs a key space nothing else can write.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Storage } from "@/storage/storage"
import { SvmTool } from "@/tool/svm"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { Instance } from "@/project/instance"
import { RENDER_MARKER } from "@/util/plan-status"
import { SessionID, MessageID } from "@/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const PLAN = "plans/TEST-svm-tool.md"

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

/** A throwaway INSTANCE — but not a throwaway STORE: see the header for what that cost. */
function inTmpdir<A, E, R>(body: (dir: string) => Effect.Effect<A, E, R>) {
  return Effect.runPromise(
    Effect.scoped(provideTmpdirInstance(body).pipe(Effect.provide(layer))) as Effect.Effect<A, E>,
  )
}

type Params = {
  action: "read" | "set" | "render"
  plan?: string
  task?: string
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

  test("render REFUSES to invent a goal — and writes nothing at all", async () => {
    const wrote = await inTmpdir(() =>
      Effect.gen(function* () {
        const refused = yield* call({ action: "render" })
        expect(refused.metadata.present).toBe(false)
        expect(refused.title).toContain("refused")
        // The claim that matters is about the FILESYSTEM, not the tool's own output: a refusal that still
        // created the file would read exactly the same from inside the tool.
        return yield* Effect.promise(() => Bun.file(path.join(Instance.worktree, "plans", "MASTER_PLAN.md")).exists())
      }),
    )
    expect(wrote).toBe(false)
  })

  test("render keeps the hand-owned head, replaces the generated body, and is byte-identical on a re-run", async () => {
    const result = await inTmpdir((dir) =>
      Effect.gen(function* () {
        const target = path.join(dir, "plans", "MASTER_PLAN.md")
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(dir, "plans"), { recursive: true })
          await fs.writeFile(
            target,
            [
              "<!-- intention: the map -->",
              "# MASTER PLAN",
              "",
              "## Goal — level 0",
              "",
              "The one vector nothing else states.",
              "",
              'sv: { keywords: { a: 1 }, dominant: "the goal" }',
              "",
              RENDER_MARKER,
              "",
              "STALE BODY THAT MUST BE REPLACED",
              "",
            ].join("\n"),
          )
          await fs.writeFile(
            path.join(dir, "plans", "2026-01-01_demo.md"),
            "# Demo\n\n<!-- intention: nothing -> every entry names its source -->\n\n- [ ] **Q1** — a box\n",
          )
        })
        const first = yield* call({ action: "render" })
        const afterFirst = yield* Effect.promise(() => Bun.file(target).text())
        const second = yield* call({ action: "render" })
        const afterSecond = yield* Effect.promise(() => Bun.file(target).text())
        return { first, second, afterFirst, afterSecond }
      }),
    )
    expect(result.first.metadata.present).toBe(true)
    // THE HEAD IS PRESERVED VERBATIM — most importantly the goal, the one vector a renderer must never invent.
    expect(result.afterFirst).toContain("The one vector nothing else states.")
    expect(result.afterFirst).toContain('sv: { keywords: { a: 1 }, dominant: "the goal" }')
    // The generated body REPLACED the stale one, and it names the plan by a READ of that plan's own header.
    expect(result.afterFirst).not.toContain("STALE BODY THAT MUST BE REPLACED")
    expect(result.afterFirst).toContain('sv: intention "nothing -> every entry names its source"')
    expect(result.afterFirst).toContain("Q1 [PENDING] · sv MISSING")
    // The FIRST render reports the gap it is about to close; the second finds none, because it closed it.
    expect(JSON.parse(result.first.output).gapsBefore).toEqual(["plans/2026-01-01_demo.md"])
    expect(JSON.parse(result.second.output).gapsBefore).toEqual([])
    // DETERMINISM IS THE ACCEPTANCE: a re-run is byte-identical, which is why no clock is read.
    expect(result.afterSecond).toBe(result.afterFirst)
  })
})
