/**
 * The log-search time window, and the level filter.
 *
 * Both defects were the same class — an instrument that answers a different question than the one it
 * was asked, or that reports its OWN failure as absence (measured 2026-09-21):
 *
 *   - `since` was turned into a FILENAME GLOB built from the cutoff's first seven digits. Seven digits
 *     of a millisecond epoch pin a ~16-minute BAND instead of "after the cutoff", so `since: 60m`
 *     matched only names beginning inside that one band and the tool answered «No matches found» while
 *     79 matching lines sat in the directory.
 *   - `level` was pushed as a SECOND pattern (`-e ERROR -e <pattern>`), which ripgrep reads as an
 *     ALTERNATION — so a level-filtered search returned lines the pattern never matched.
 *
 * The window is a comparison, so it is tested AS one: a band and a window agree on nothing except by
 * accident, which is exactly why the falsifiers below name both ends of the span.
 */
import { afterAll, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { filesInWindow, levelToken } from "../../src/tool/logsearch"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logsearch-window-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const now = Date.now()
/** Named the way the log plane names its files: the write's epoch-ms, then the kind. */
const stamp = (msAgo: number) => `${now - msAgo}_log_system_internal.jsonl`
const fiveMin = stamp(5 * 60_000)
const thirtyMin = stamp(30 * 60_000)
const threeHours = stamp(3 * 60 * 60_000)
for (const name of [fiveMin, thirtyMin, threeHours, "not-a-timestamp.jsonl"]) {
  fs.writeFileSync(path.join(dir, name), "")
}

describe("logsearch: the window is a COMPARISON, not a name pattern", () => {
  test("no window, or an unparseable one, searches EVERYTHING — never a silent subset", () => {
    expect(filesInWindow(dir, undefined)).toBeNull()
    expect(filesInWindow(dir, "whenever")).toBeNull()
  })

  test("a 1h window holds the 5m and 30m files and excludes the 3h one", () => {
    const list = filesInWindow(dir, "1h")
    expect(list).not.toBeNull()
    expect(list!).toContain(fiveMin)
    expect(list!).toContain(thirtyMin)
    expect(list!).not.toContain(threeHours)
  })

  test("the span reaches BACK to the cutoff — it is not a ~16-minute band at it", () => {
    // The falsifier for the deleted implementation: it pinned one band at the cutoff, so it could never
    // hold BOTH the oldest and the newest file of the window at once.
    //
    // The window is asked for as 4h, which puts the 3h-old file an hour INSIDE it. Asking for exactly
    // "3h" would stand the assertion ON the boundary, where it measures the few milliseconds between
    // the test's own `Date.now()` and the one inside `filesInWindow` — clock skew, not the instrument.
    const list = filesInWindow(dir, "4h")!
    expect(list).toContain(threeHours)
    expect(list).toContain(fiveMin)
  })

  test("POSITIVE CONTROL — a window wide enough holds every dated file", () => {
    expect(filesInWindow(dir, "1d")!).toEqual(expect.arrayContaining([fiveMin, thirtyMin, threeHours]))
  })

  test("a name whose time cannot be read is KEPT — only the PROVEN out-of-window is left out", () => {
    expect(filesInWindow(dir, "1h")!).toContain("not-a-timestamp.jsonl")
  })
})

describe("logsearch: the level token", () => {
  test("a JSON level is the FIELD it must match, and `bug` is the marker", () => {
    expect(levelToken("ERROR")).toBe('"level":"ERROR"')
    expect(levelToken("warn")).toBe('"level":"WARN"')
    expect(levelToken("bug")).toBe("bug:")
  })

  test("an unknown level widens the search rather than narrowing it", () => {
    expect(levelToken("TRACE")).toBe("TRACE")
  })
})
