import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chainHash, hashLabel, lines, parseHash } from "../../src/tool/read"

/**
 * THE LINE ADDRESS — the PURE half (plan 2026-10-01_hash-addressed-edits, H1/H2).
 *
 * Four properties carry the whole scheme, and each one is a way the address could lie while everything else
 * still looked green:
 *
 *   1. stable       — the same bytes print the same labels;
 *   2. CRLF ≡ LF    — the class `oldString` could never survive, and the fuzzy cascade existed only to forgive;
 *   3. window-free  — line 2 hashes the same read alone or inside a range;
 *   4. prefix-bound — two IDENTICAL lines get DIFFERENT addresses.
 *
 * WHY THIS IS A SEPARATE FILE, and it is not litter. `read.test.ts` drives the real tool through real Effect
 * layers (Instance, LSP, git-backed tmpdirs) and on 2026-10-01 it stopped producing ANY verdict: no log,
 * `bytes_written: 0`, `cpu_delta_seconds=0`, while `jobwait` reported `done`. This file touches only `lines()`
 * — a plain async byte reader — and three pure functions, so it runs and its green means something.
 *
 * The integration form of the same four cases stays in `read.test.ts` and is OWED a verdict once that harness
 * is qualified (@TOOLCHAIN_QUALIFICATION). Two forms, two layers, on purpose: a property that can be checked
 * without the broken layer must not wait for it, and a property checked ONLY without its layer stops testing
 * what a caller actually crosses — the lesson F6 was paid for an hour earlier.
 */
const withFile = async <T>(name: string, content: string, body: (path: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), "read-address-"))
  try {
    const path = join(dir, name)
    await writeFile(path, content)
    return await body(path)
  } finally {
    // `force` because Windows holds handles: a leftover temp dir is harmless, a thrown cleanup is not.
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

describe("read — the line address (pure)", () => {
  test("a label is 8 hex and round-trips; any other shape parses to undefined", () => {
    expect(hashLabel(chainHash(0, "alpha"))).toMatch(/^[0-9a-f]{8}$/)
    expect(parseHash(hashLabel(chainHash(0, "alpha")))).toBe(chainHash(0, "alpha"))
    // The printed form is the ONLY accepted form: a lenient parser would let a caller invent an address.
    expect(parseHash("3F19C2EA")).toBeUndefined()
    expect(parseHash("3f19c2e")).toBeUndefined()
    expect(parseHash("")).toBeUndefined()
  })

  test("CRLF and LF hash IDENTICALLY — the class `oldString` could not survive", async () => {
    const lf = await withFile("lf.txt", "alpha\nbeta\n", (p) => lines(p, { limit: 10, offset: 1 }))
    const crlf = await withFile("crlf.txt", "alpha\r\nbeta\r\n", (p) => lines(p, { limit: 10, offset: 1 }))

    expect(crlf.raw).toEqual(lf.raw)
    expect(crlf.hashes).toEqual(lf.hashes)
  })

  test("the WINDOW does not move an address — line 2 alone equals line 2 in a range", async () => {
    const content = "one\ntwo\nthree\nfour\n"
    const whole = await withFile("w.txt", content, (p) => lines(p, { limit: 10, offset: 1 }))
    const slice = await withFile("w.txt", content, (p) => lines(p, { limit: 1, offset: 2 }))

    expect(slice.raw).toEqual(["two"])
    // This is the property the implementation could get wrong in ONE line — moving the chain below the skip —
    // and it would stay invisible to every other case here.
    expect(slice.hashes[0]).toBe(whole.hashes[1])
  })

  test("two IDENTICAL lines get DIFFERENT addresses — the chain carries the prefix", async () => {
    const result = await withFile("dup.txt", "same\nsame\n", (p) => lines(p, { limit: 10, offset: 1 }))

    expect(result.raw).toEqual(["same", "same"])
    // The case that failed LIVE an hour earlier: the content path refused
    // experiments/2026-10-01_edit-range-verify/dup-lines.txt with «Found multiple matches for oldString».
    expect(result.hashes[0]).not.toBe(result.hashes[1])
  })

  test("a line is chained, not merely hashed: the SAME text under a different prefix differs", () => {
    const bare = chainHash(0, "beta")
    const afterAlpha = chainHash(chainHash(0, "alpha"), "beta")

    expect(afterAlpha).not.toBe(bare)
    // …and it is deterministic, which is what makes a re-read reproduce an address rather than chance upon it.
    expect(chainHash(chainHash(0, "alpha"), "beta")).toBe(afterAlpha)
  })

  test("the case that made anchors useless: smeared braces, no unique line to anchor on", async () => {
    // Owner, 2026-10-01: «Я помню как ты плевался когда в файле было {{{{{}}}}} размазанные. Поди найди
    // паттерн.» Twenty STRUCTURALLY IDENTICAL lines: a content anchor cannot name one of them, and every fuzzy
    // stage of the old cascade could only ever GUESS — then call the guess a success, because the success said
    // nothing about which stage had fired. The chain names each line by its own prefix, so «find the pattern»
    // stops being a task at all.
    const result = await withFile("braces.txt", "    }}}}\n".repeat(20), (p) => lines(p, { limit: 30, offset: 1 }))

    expect(result.raw.length).toBe(20)
    expect(result.raw[0]).toBe(result.raw[19])
    expect(new Set(result.hashes).size).toBe(20)
    expect(result.hashes[0]).not.toBe(result.hashes[19])
  })
})
