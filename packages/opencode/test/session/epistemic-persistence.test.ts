/**
 * The claim ledger's durable row (owner, 2026-09-22: `@LOOP_MEASURE`'s `unstamped_claims` has to be
 * READ from an artifact, not remembered).
 *
 * The epistemics in `constitution.ts` were an in-memory Map: a restart emptied them, so the debt a
 * fold cares about became uncountable exactly when a new window needed it. The falsifier is therefore
 * a RESTART, simulated the way the process does it — the Map is dropped, and the same numbers must
 * come back from the row.
 *
 * HARNESS, and this file carries its second lesson: `test(name, effect)` hands bun an Effect object,
 * which is not a promise, so the body NEVER RUNS and the test passes. Written that way first, this
 * file reported 1 pass — with unprovided services in its type, which is what the typecheck caught and
 * the runner could not. The working shape is `tail-note.test.ts`'s: async test → `tmpdir()` →
 * `Instance.provide` → `Effect.runPromise(provideInstance(...)(...))`, with `R` discharged (no service
 * is needed here: the ledger row is keyed by session id and carries no foreign key).
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect } from "effect"
import { Constitution } from "../../src/session/constitution"
import { Instance } from "../../src/project/instance"
import { provideInstance, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

setDefaultTimeout(30_000)

/** Written the way the assistant writes it: the parser reads THIS, not a fixture object. */
const LEDGER = `
claim_ledger:
  claims:
    - id: C1
      text: "the fold reads its head from the rows"
      status: Hypothetical
      falsifier: "read buildMessageStar"
  premises_for_plan: [C1]
`

const SID = "ses_epistemic_persistence"

describe("the claim ledger's durable row", () => {
  test("a restart rehydrates the debt instead of zeroing it", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Effect.runPromise(
          provideInstance(tmp.path)(
            Effect.gen(function* () {
              Constitution.resetEpistemicState(SID)
              Constitution.ingestAssistantText(SID, LEDGER)
              Constitution.flushEpistemic(SID)
              const before = Constitution.claimDebt(SID)
              expect(before).toEqual({ claims: 1, unstamped: 1 })

              // THE RESTART — exactly what the process does to the Map when it dies.
              Constitution.resetEpistemicState(SID)
              expect(Constitution.claimDebt(SID)).toEqual(before)

              // And the row is per SESSION: another one does not inherit a claim it never made.
              expect(Constitution.claimDebt("ses_epistemic_other")).toEqual({ claims: 0, unstamped: 0 })
            }),
          ),
        )
      },
    })
  })
})
