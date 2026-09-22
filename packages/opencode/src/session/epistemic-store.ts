/**
 * The claim ledger's durable carrier: one row per session, read back whole.
 *
 * WHY it exists: the epistemics in `constitution.ts` were an in-memory Map, so a restart emptied
 * them — `@LOOP_MEASURE`'s `unstamped_claims` could not be counted, and every fold began with a debt
 * the system could not see (owner, 2026-09-22: the debt has to be READ from artifacts, not
 * remembered). With the sidecar capture gone nothing else produces that state.
 *
 * SHAPE, recorded rather than hidden: this is keyed state — one blob per session — which is the FAST
 * plane's shape (`{state}/…` semantics), but LMDB is not deployed yet: its import shim is unwritten
 * and the built binary does not carry it. So the blob lives in the relational plane as a single row
 * until the fast plane exists. When LMDB lands, this moves and the table goes with it.
 *
 * Deliberately dumb: a string in, a string out. The codec lives with the types it serializes
 * (`constitution.ts`), so nothing here needs to know what a claim is.
 */
import { eq } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Database } from "@/storage/db"
import { SessionEpistemicTable } from "./session.sql"

const log = Log.create({ service: "session.epistemic-store" })

/**
 * The store is an ENHANCEMENT, never a precondition: with no instance context (unit tests, tooling)
 * or a closed database, the ledger simply stays in memory — the behaviour every caller had before
 * this row existed. Measured 2026-09-22: the constitution suite calls the epistemic functions with no
 * instance at all, and `Database.use` throws "No context found for database" — the whole suite went
 * red until this became a fallback instead of a requirement. Logged, never silent: a store that
 * quietly stops storing is the defect class this project keeps paying for.
 */
function noContext(op: string, sessionID: string, cause: unknown) {
  log.debug("epistemic store unavailable — the ledger stays in memory", {
    op,
    sessionID,
    error: String(cause),
  })
}

/** The stored blob for a session, or undefined when nothing was ever written (or nothing is open). */
export function loadEpistemic(sessionID: string): string | undefined {
  try {
    return Database.use(
      (db) =>
        db
          .select({ data: SessionEpistemicTable.data })
          .from(SessionEpistemicTable)
          .where(eq(SessionEpistemicTable.session_id, sessionID))
          .all()[0]?.data,
    )
  } catch (cause) {
    noContext("load", sessionID, cause)
    return undefined
  }
}

/** Write the blob for a session, replacing whatever was there. */
export function saveEpistemic(sessionID: string, data: string): void {
  const time_updated = Date.now()
  try {
    Database.use((db) => {
      db.insert(SessionEpistemicTable)
        .values({ session_id: sessionID, data, time_updated })
        .onConflictDoUpdate({
          target: SessionEpistemicTable.session_id,
          set: { data, time_updated },
        })
        .run()
    })
  } catch (cause) {
    noContext("save", sessionID, cause)
  }
}
