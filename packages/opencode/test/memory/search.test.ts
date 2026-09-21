import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { Effect } from "effect"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { getProjectDbPath } from "../../src/storage/db"
import * as Memory from "../../src/memory/memory"
import { Session as SessionNs } from "@/session/session"
import { Global } from "@opencode-ai/core/global"

/**
 * The instruments that hold the agent's own memory shipped without a working smoke: the file
 * named `message-search.test.ts` tests the highlighter and the semantic vectors, and never the
 * search. Measured 2026-09-21: `Memory.search({ query: "re-base opentui" })` died with FTS5's
 * `no such column: base`, because the raw query reached `MATCH` — where `-` is an operator and
 * `col:term` is a column filter — and the project's whole vocabulary is hyphenated (`re-base`,
 * `Layer-1`, `deliver-once`).
 *
 * This file searches for real: the FTS5 schema is the one `Memory.sync` creates in production,
 * the rows come from a real project DB, and the queries are the vocabulary we actually use.
 * Hermetic by construction — `Instance.provide` redirects `Global.Path.data`, so the index is
 * built in the temp worktree and the live one is untouched.
 */
setDefaultTimeout(60_000)

afterEach(async () => {
  await Instance.disposeAll()
})

/** Seed one real session plus parts into the project DB, then index them the way the tool does. */
async function indexFixture(parts: Array<Record<string, unknown>>): Promise<string> {
  await using tmp = await tmpdir()
  const dir = tmp.path
  await Instance.provide({
    directory: dir,
    fn: async () => {
      const sessionID = await Effect.runPromise(
        provideInstance(dir)(
          Effect.gen(function* () {
            const session = yield* (yield* SessionNs.Service).create({})
            return session.id
          }),
        ).pipe(Effect.provide(SessionNs.defaultLayer)),
      )

      const projectDb = new BunDatabase(getProjectDbPath(dir))
      const now = Date.now()
      const messageID = "msg_search_smoke_1"
      projectDb.run(
        "INSERT INTO message (id, session_id, time_created, time_updated, compacted, data) VALUES (?, ?, ?, ?, 0, ?)",
        [messageID, sessionID, now, now, JSON.stringify({ role: "user" })],
      )
      parts.forEach((part, index) => {
        projectDb.run(
          "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
          [`prt_search_smoke_${index}`, messageID, sessionID, now, now, JSON.stringify(part)],
        )
      })
      projectDb.close()

      // The real path: sync builds/extends memory.db (and its FTS5 table), then search reads it.
      Memory.sync(dir, getProjectDbPath(dir))
    },
  })

  // The smoke proves its own hermeticity: a redirected data root means the live index is safe.
  expect(Global.Path.data.startsWith(dir)).toBe(true)
  return dir
}

const VOCABULARY = [
  { type: "text", text: "re-base the fork on opentui 0.5.11 — the pixel oracle passed" },
  { type: "text", text: "Layer-1 folds the exchange; the deliver-once gate keeps 8000 chars" },
  { type: "text", text: "проверка непрерывности памяти после свёртки окна" },
]

describe("Memory.search — the instrument that holds the agent's own memory", () => {
  test("a hyphenated project term finds its part instead of throwing", async () => {
    const dir = await indexFixture(VOCABULARY)
    const hits = Memory.search({ worktree: dir, query: "re-base opentui", limit: 10 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((hit) => hit.text.includes("pixel oracle"))).toBe(true)
  })

  test("FTS5 operator syntax is treated as words, not as a query language", async () => {
    const dir = await indexFixture(VOCABULARY)
    const hits = Memory.search({ worktree: dir, query: "role:user OR NOT base", limit: 10 })
    expect(Array.isArray(hits)).toBe(true)
  })

  test("Cyrillic survives the tokenizer — half our transcript is Russian", async () => {
    const dir = await indexFixture(VOCABULARY)
    const hits = Memory.search({ worktree: dir, query: "непрерывности памяти", limit: 10 })
    expect(hits.length).toBeGreaterThan(0)
  })

  test("a second hyphenated term is found too, so the fix is not one lucky phrase", async () => {
    const dir = await indexFixture(VOCABULARY)
    expect(Memory.search({ worktree: dir, query: "Layer-1", limit: 10 }).length).toBeGreaterThan(0)
    expect(Memory.search({ worktree: dir, query: "deliver-once", limit: 10 }).length).toBeGreaterThan(0)
  })

  test("ranking is ordered and the session scope really scopes", async () => {
    const dir = await indexFixture(VOCABULARY)
    const hits = Memory.search({ worktree: dir, query: "re-base", limit: 10 })
    for (let index = 1; index < hits.length; index++) {
      expect(hits[index].rank).toBeLessThanOrEqual(hits[index - 1].rank)
    }
    expect(Memory.search({ worktree: dir, query: "re-base", limit: 10, sessionID: "ses_absent" as never }).length).toBe(0)
  })

  test("a query with nothing to match returns nothing and does not kill the tool", async () => {
    const dir = await indexFixture(VOCABULARY)
    expect(Memory.search({ worktree: dir, query: "zzz-absent-term", limit: 10 })).toEqual([])
    expect(Memory.search({ worktree: dir, query: "   ", limit: 10 })).toEqual([])
  })
})
