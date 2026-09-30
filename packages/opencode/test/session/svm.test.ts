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

  test("renderBody reads every vector from its source, prints MISSING for what is absent, and is deterministic", async () => {
    // S4's whole claim in one case: the map COPIES nothing (every value is a read of its source), invents
    // nothing (an absent vector is printed MISSING, never filled in), and is stable (two renders in a row are
    // byte-identical — which is why no clock is read and the plans are sorted).
    const result = await inTmpdir((dir) =>
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(dir, "plans"), { recursive: true })
          await fs.writeFile(
            path.join(dir, "plans", "2026-01-01_demo.md"),
            [
              "# Demo",
              "",
              "<!-- intention: nothing says what this plan is for -> every entry names its own source -->",
              "<!-- goal_sv: rendering, provenance -->",
              "",
              "- [ ] **Q1** — a tagged box <!-- sv: alpha, beta -->",
              "- [ ] **Q2** — an untagged box",
              "",
            ].join("\n"),
          )
        })
        yield* SVM.write(storage, "plans/2026-01-01_demo.md", {
          task: "Q1",
          plan: "plans/2026-01-01_demo.md",
          sv: "Keywords: alpha 0.6, beta 0.4\nSemantic dominant: the first box is written down.",
          etaTurns: 2,
          state: "doing",
          oracle: "bun test test/session/svm.test.ts",
        })
        return { first: yield* SVM.renderBody(dir, storage), second: yield* SVM.renderBody(dir, storage) }
      }),
    )
    const { body, stats } = result.first
    // READ FROM THE SOURCE — the plan's own header supplies its vector; nothing here was authored by render.
    expect(body).toContain('sv: intention "nothing says what this plan is for -> every entry names its own source"')
    expect(body).toContain("keywords [rendering, provenance]")
    // A tagged box carries its own vector; an untagged one SAYS MISSING instead of printing nothing.
    expect(body).toContain("Q1 [PENDING] · sv [alpha, beta] · manifest: the first box is written down. · eta 2 · doing")
    expect(body).toContain("Q2 [PENDING] · sv MISSING · manifest: MISSING")
    expect(stats).toEqual({
      plans: 1,
      openBoxes: 2,
      missingPlanSv: 0,
      missingTaskSv: 1,
      missingManifests: 1,
      gapsBefore: [],
    })
    expect(result.second.body).toBe(body)
  })

  test("the plan-ref invariant: an orphaned manifest is NAMED and a live one is NOT (plan S5)", async () => {
    // BOTH halves in one case, because each alone is a defect. Reporting nothing is the silence the store
    // has today: there is no `remove` (see `session/svm.ts`'s header), and the map is built FROM the plan
    // files, so a record whose plan has LEFT is unreachable by any plan-by-plan walk — it would sit there
    // for good, reading as a direction somebody once chose. Reporting everything is an alerter nobody
    // reads, which is the defect the coupling watcher's first live finding already was.
    //
    // DELIBERATELY NOT an exact-set assertion. The store is shared and persists across runs (see this
    // file's header), so records ANOTHER file wrote — whose plans do not exist in this tmpdir — are
    // honest orphans of this call too. Membership in, and absence from, MY OWN keys is a statement about
    // the code; a count would be a statement about the history of `.temp/test`.
    const LIVE_PLAN = "plans/TEST-svm-live.md"
    const MOVED_PLAN = "plans/TEST-svm-moved.md"
    const GONE_PLAN = "plans/TEST-svm-gone.md"

    const result = await inTmpdir((dir) =>
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(dir, "plans"), { recursive: true })
          await fs.mkdir(path.join(dir, "plans_completed"), { recursive: true })
          await fs.writeFile(path.join(dir, LIVE_PLAN), "# live\n")
          // The MOVED plan EXISTS — just not where the record was keyed.
          await fs.writeFile(path.join(dir, "plans_completed", "TEST-svm-moved.md"), "# moved\n")
        })
        yield* SVM.write(storage, LIVE_PLAN, { ...record, task: "LIVE", plan: LIVE_PLAN })
        yield* SVM.write(storage, MOVED_PLAN, { ...record, task: "MOVED", plan: MOVED_PLAN })
        yield* SVM.write(storage, GONE_PLAN, { ...record, task: "GONE", plan: GONE_PLAN })
        return SVM.orphanManifests(dir)
      }),
    )

    const named = result.orphans.map((orphan) => `${orphan.plan} ${orphan.task}`)
    // HALF ONE — the record whose plan is gone is NAMED. Nothing else in the runtime would ever say it.
    expect(named).toContain(`${GONE_PLAN} GONE`)
    expect(result.orphans.find((orphan) => orphan.task === "GONE")?.reason).toBe("deleted")
    // MOVED and DELETED are different findings with different remedies, so they are never folded together.
    expect(named).toContain(`${MOVED_PLAN} MOVED`)
    expect(result.orphans.find((orphan) => orphan.task === "MOVED")?.reason).toBe("moved")
    // HALF TWO — the record whose plan IS there is not flagged. Without this half the check passes by
    // naming every record it can see.
    expect(named).not.toContain(`${LIVE_PLAN} LIVE`)
    // And they were LOOKED AT: a check that examined nothing cannot be told from one that found nothing.
    expect(result.checked).toBeGreaterThan(0)
  })
})
