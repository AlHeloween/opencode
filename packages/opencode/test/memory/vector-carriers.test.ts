import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { Effect } from "effect"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { getProjectDbPath } from "../../src/storage/db"
import * as Memory from "../../src/memory/memory"
import { chainBreaks, extractVectorChain, hasSemanticVector } from "../../src/memory/spine"
import { Session as SessionNs } from "@/session/session"
import { Global } from "@opencode-ai/core/global"

/**
 * The vector chain, read from the index instead of by re-parsing prose: `listVectorCarriers`
 * returns the parts whose text DECLARED a vector (newest first, ULID order), and `hasSession`
 * tells «not indexed» apart from «said nothing». Hermetic by the `search.test.ts` harness —
 * the index is built inside a temp worktree, the live one is untouched.
 */
setDefaultTimeout(60_000)

afterEach(async () => {
  await Instance.disposeAll()
})

const older = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const newer = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

function vectorBlock(tag: string, md5: string, prevMd5: string): string {
  return [
    `prose for ${tag}`,
    ``,
    `Keywords: sv-chain 0.6, scope 0.4`,
    `Semantic dominant: ${tag} — the one-line focus`,
    `md5: ${md5}`,
    `prev-md5: ${prevMd5}`,
    `parent-goal-md5: 00000000000000000000000000000000`,
  ].join("\n")
}

async function indexProject(): Promise<{ dir: string; sessionID: string }> {
  await using tmp = await tmpdir()
  const dir = tmp.path
  let sessionID = ""
  await Instance.provide({
    directory: dir,
    fn: async () => {
      sessionID = await Effect.runPromise(
        provideInstance(dir)(
          Effect.gen(function* () {
            const session = yield* (yield* SessionNs.Service).create({})
            return session.id
          }),
        ).pipe(Effect.provide(SessionNs.defaultLayer)),
      )

      const projectDb = new BunDatabase(getProjectDbPath(dir))
      const now = Date.now()
      const message = (id: string, role: string, at: number) =>
        projectDb.run(
          "INSERT INTO message (id, session_id, time_created, time_updated, compacted, data) VALUES (?, ?, ?, ?, 0, ?)",
          [id, sessionID, at, at, JSON.stringify({ role })],
        )
      const textPart = (partID: string, messageID: string, at: number, text: string) =>
        projectDb.run(
          "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
          [partID, messageID, sessionID, at, at, JSON.stringify({ type: "text", text })],
        )

      message("msg_sv_user", "user", now)
      message("msg_sv_a", "assistant", now + 1)
      textPart("prt_sv_a", "msg_sv_a", now + 1, vectorBlock("older", older, "0".repeat(32)))
      message("msg_sv_b", "assistant", now + 2)
      textPart("prt_sv_b", "msg_sv_b", now + 2, vectorBlock("newer", newer, older))
      // A QUOTE is not a carrier: the cheap marker admits it, the full predicate drops it.
      message("msg_sv_q", "assistant", now + 3)
      textPart("prt_sv_q", "msg_sv_q", now + 3, "the plan says `md5: deadbeef` and `prev-md5: …` — quoted, not declared")
      projectDb.close()

      // The real path: sync builds/extends memory.db, then the readers answer.
      Memory.sync(dir, getProjectDbPath(dir))
    },
  })
  expect(Global.Path.data.startsWith(dir)).toBe(true)
  return { dir, sessionID }
}

describe("Memory.listVectorCarriers — the chain read from the index", () => {
  test("newest first, one row per candidate, the quote admitted by the cheap marker", async () => {
    const { dir } = await indexProject()
    const rows = Memory.listVectorCarriers({ worktree: dir, limit: 50 })
    // ULID order = time order; the quoting row is in the pool BY DESIGN — the full predicate is
    // the caller's projection (`hasSemanticVector`), exactly as `listDominants` splits it.
    expect(rows.map((row) => row.messageID)).toEqual(["msg_sv_q", "msg_sv_b", "msg_sv_a"])
    for (const row of rows) expect(row.sessionID.length).toBeGreaterThan(0)
  })

  test("the projection keeps declared vectors and drops the quote, and the link reads intact", async () => {
    const { dir } = await indexProject()
    const chains = Memory.listVectorCarriers({ worktree: dir, limit: 50 }).flatMap((row) =>
      hasSemanticVector(row.text) ? [extractVectorChain(row.text)] : [],
    )
    expect(chains.map((chain) => chain.md5)).toEqual([newer, older])
    // Both rows are one session's chain, read oldest-first: newer.prev === older.md5 → 0 breaks.
    const oldestFirst = chains.reverse().map((chain) => ({ md5: chain.md5, prevMd5: chain.prevMd5 }))
    expect(chainBreaks(oldestFirst)).toBe(0)
  })

  test("a session filter narrows to its own carriers", async () => {
    const { dir, sessionID } = await indexProject()
    const mine = Memory.listVectorCarriers({ worktree: dir, sessionID, limit: 50 })
    expect(mine.length).toBe(3)
    expect(Memory.listVectorCarriers({ worktree: dir, sessionID: "ses_absent", limit: 50 })).toEqual([])
  })
})

describe("Memory.hasSession — «not indexed» is not «said nothing»", () => {
  test("names the difference for a live session and an absent one", async () => {
    const { dir, sessionID } = await indexProject()
    expect(Memory.hasSession({ worktree: dir, sessionID })).toBe(true)
    expect(Memory.hasSession({ worktree: dir, sessionID: "ses_absent" })).toBe(false)
  })
})
