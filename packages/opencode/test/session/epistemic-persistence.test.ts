/**
 * The claim ledger's durable row (owner, 2026-09-22: `@LOOP_MEASURE`'s `unstamped_claims` has to be
 * READ from an artifact, not remembered).
 *
 * The epistemics in `constitution.ts` were an in-memory Map: a restart emptied them, so the debt a
 * fold cares about became uncountable exactly when a new window needed it. The falsifier is therefore
 * a RESTART, simulated the way the process does it — the Map is dropped, and the same numbers must
 * come back from the row.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect } from "effect"
import { Constitution } from "../../src/session/constitution"
import { Session as SessionNs } from "@/session/session"
import { provideTmpdirInstance } from "../fixture/fixture"

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

describe("the claim ledger's durable row", () => {
  test("a restart rehydrates the debt instead of zeroing it", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const sid = info.id

        Constitution.ingestAssistantText(sid, LEDGER)
        Constitution.flushEpistemic(sid)
        const before = Constitution.claimDebt(sid)
        expect(before).toEqual({ claims: 1, unstamped: 1 })

        // THE RESTART — exactly what the process does to the Map when it dies.
        Constitution.resetEpistemicState(sid)
        expect(Constitution.claimDebt(sid)).toEqual(before)

        // And the row is per SESSION: a fresh one does not inherit a claim it never made.
        const other = yield* ssn.create({})
        expect(Constitution.claimDebt(other.id)).toEqual({ claims: 0, unstamped: 0 })
      }),
    ))
})
