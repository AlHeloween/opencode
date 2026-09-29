/**
 * The task manifest's store — round-trip, and the two things it must never do:
 * invent a record, and swallow a missing one.
 *
 * S1b of plans/2026-09-29_svm-tool-and-master-plan.md. S1 shipped `src/session/svm.ts` without this
 * file rather than leave a red tree behind; the fixture was the blocker. The recipe, measured here
 * rather than guessed: `provideTmpdirInstance` runs inside `Effect.scoped` (it yields a `Scope`) and
 * needs `ChildProcessSpawner` — supplied by `CrossSpawnSpawner.defaultLayer`, the same merge the
 * sibling Storage tests (`summary.test.ts`, `mechanical-writer.test.ts`) use.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Storage } from "@/storage/storage"
import * as SVM from "@/session/svm"
import { provideTmpdirInstance } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const layer = Storage.defaultLayer.pipe(Layer.provideMerge(CrossSpawnSpawner.defaultLayer))

const record: SVM.SVMRecord = {
  task: "S1b",
  plan: "plans/2026-09-29_svm-tool-and-master-plan.md",
  sv: "Keywords: store 0.6, manifest 0.4\nSemantic dominant: the manifest round-trips.",
  etaTurns: 1,
  state: "doing",
  oracle: "bun test test/session/svm.test.ts",
}

/** Everything runs inside a throwaway instance, so the real store is never touched. */
function inTmpdir<A, E, R>(body: (dir: string) => Effect.Effect<A, E, R>) {
  return Effect.runPromise(
    Effect.scoped(provideTmpdirInstance(body).pipe(Effect.provide(layer))) as Effect.Effect<A, E>,
  )
}

describe("SVM store", () => {
  test("the plan key survives becoming a file path", () => {
    expect(SVM.planKey("plans/2026-09-29_svm-tool-and-master-plan.md")).toBe("2026-09-29_svm-tool-and-master-plan")
    // Windows separators resolve the same way; the key must not carry one.
    expect(SVM.planKey("plans\\2026-09-29_x.md")).toBe("2026-09-29_x")
    // A file without the extension still resolves — nothing is invented either way.
    expect(SVM.planKey("plans/plain")).toBe("plain")
    // The key is the contract with the store, so it is pinned rather than described.
    expect(SVM.taskKey("plans/2026-09-29_x.md", "S3")).toEqual(["svm", "task", "2026-09-29_x", "S3"])
  })

  test("a written manifest is read back field for field", async () => {
    const result = await inTmpdir(() =>
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* SVM.write(storage, record.plan, record)
        return yield* SVM.read(storage, record.plan, "S1b")
      }),
    )
    expect(result).toEqual(record)
  })

  test("a task with no manifest reads as undefined, never as an empty one", async () => {
    const result = await inTmpdir(() =>
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* SVM.read(storage, record.plan, "NEVER-WRITTEN")
      }),
    )
    expect(result).toBeUndefined()
  })

  test("missing() names exactly the tasks without a manifest", async () => {
    const result = await inTmpdir(() =>
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* SVM.write(storage, record.plan, record)
        return yield* SVM.missing(storage, record.plan, ["S1b", "S2", "S3"])
      }),
    )
    expect(result).toEqual(["S2", "S3"])
  })
})
