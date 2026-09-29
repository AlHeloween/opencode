/**
 * The task manifest's store — round-trip, and the two things it must never do:
 * invent a record, and swallow a missing one.
 *
 * S1b of plans/2026-09-29_svm-tool-and-master-plan.md. S1 shipped `src/session/svm.ts` without this
 * file rather than leave a red tree behind; the fixture was the blocker. The recipe, measured here
 * rather than guessed: `provideTmpdirInstance` runs inside `Effect.scoped` (it yields a `Scope`) and
 * needs `ChildProcessSpawner` — supplied by `CrossSpawnSpawner.defaultLayer`, the same merge the
 * sibling Storage tests (`summary.test.ts`, `mechanical-writer.test.ts`) use.
 *
 * THE STORE IS NOT THROWAWAY, and this file says so because it was measured the hard way
 * (2026-09-30): `Storage` resolves its root from `Global.Path.data`, which the fixture leaves at
 * `TEST_TEMP` — the scope finalizer re-points the process there on purpose, so Effect's reporter never
 * writes into a removed worktree. A record therefore SURVIVES into the next run. Measured: this file's
 * `missing()` case read `S2` as present because `test/tool/svm.test.ts` had written exactly that key
 * into `…/svm/task/2026-09-29_svm-tool-and-master-plan/S2.json` — green when it ran first, red when it
 * ran second, and red on the next run of this file ALONE. An assertion over an exact SET is only a
 * statement about the code when nothing else can write into its key space.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Storage } from "@/storage/storage"
import * as SVM from "@/session/svm"
import { provideTmpdirInstance } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const layer = Storage.defaultLayer.pipe(Layer.provideMerge(CrossSpawnSpawner.defaultLayer))

/**
 * The key space this file OWNS. No other test writes it and no production writer can, so a leftover
 * from any previous run is this file's own and identical to what this run writes — which is what makes
 * the exact-set assertion below an oracle instead of a history check.
 */
const PLAN = "plans/TEST-svm-store.md"

const record: SVM.SVMRecord = {
  task: "S1b",
  plan: PLAN,
  sv: "Keywords: store 0.6, manifest 0.4\nSemantic dominant: the manifest round-trips.",
  etaTurns: 1,
  state: "doing",
  oracle: "bun test test/session/svm.test.ts",
}

/** A throwaway INSTANCE — but not a throwaway STORE. See the header: the store is shared and
 *  persists, so this file owns its own key space instead of pretending the fixture isolates it. */
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

  test("readNote resolves the SAME file the store writes", async () => {
    // Plan S3's whole risk in one assertion. The turn note cannot yield for `Storage`, so it reads the
    // manifest with `Bun.file` through `Storage.keyFile` — and a reader that rooted itself anywhere
    // other than where the SERVICE roots itself would report every task as MISSING while the store held
    // manifests: silent, permanent, and invisible in production (the fixture's own store is not where a
    // worktree-shaped guess would put it — see the header). Rooting both at `Global.Path.data` is what
    // makes them agree, so the round trip is asserted ACROSS the two implementations, not inside one.
    const result = await inTmpdir(() =>
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* SVM.write(storage, record.plan, record)
        return {
          written: yield* SVM.readNote(record.plan, "S1b"),
          absent: yield* SVM.readNote(record.plan, "NEVER-WRITTEN"),
        }
      }),
    )
    expect(result.written).toEqual({
      task: "S1b",
      // The dominant is EXTRACTED from the `@SV_FORMAT` block: the note is one line, not a block.
      dominant: "the manifest round-trips.",
      etaTurns: 1,
      state: "doing",
    })
    // A task with no manifest is `null`, never an invented shell.
    expect(result.absent).toBeNull()
    // A block that states no dominant SAYS SO — an empty string would read as a manifest that exists
    // and tells the reader nothing.
    expect(SVM.dominantOf("Keywords: a 0.6, b 0.4")).toBe("(dominant not stated)")
  })

  test("a malformed manifest reads as absent, never as a thrown turn", async () => {
    // The note's builder catches its own failures and returns an EMPTY note, so a reader that threw
    // would not report one bad manifest — it would blank the whole status surface for that turn.
    // Garbage in the file is the cheapest way to prove the reader swallows it.
    const result = await inTmpdir(() =>
      Effect.gen(function* () {
        const file = Storage.keyFile(Global.Path.data, SVM.taskKey(record.plan, "BROKEN"))
        yield* Effect.promise(() => fs.mkdir(path.dirname(file), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(file, "{not json"))
        return yield* SVM.readNote(record.plan, "BROKEN")
      }),
    )
    expect(result).toBeNull()
  })
})
