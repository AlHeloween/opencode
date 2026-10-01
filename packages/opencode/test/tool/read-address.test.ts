import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chainHash, formatHexDump, hashLabel, lines, parseHash } from "../../src/tool/read"

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
 * — a plain async byte reader — and a handful of pure functions (`chainHash`, `hashLabel`, `parseHash`,
 * `formatHexDump`), so it runs and its green means something.
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

  test("the chain is xxh3_64, truncated to 32 bits — pinned against an independent implementation", () => {
    // read and edit share chainHash, so they agree under ANY hash function: no round-trip test can tell which one
    // runs. Only an outside implementation can. Values from Python `xxhash.xxh3_64_intdigest` (2026-10-01):
    // "0\0alpha" -> 0xe1ff011f57e53539, then "<that low 32 as decimal>\0beta" — the owner chose xxh3.
    const alpha = chainHash(0, "alpha")
    expect(hashLabel(alpha)).toBe("57e53539")
    expect(hashLabel(chainHash(alpha, "beta"))).toBe("0b29c45a")
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

  test("a long line is WRAPPED with its position, not clipped — and it is still ONE line with ONE address", async () => {
    // Owner, 2026-10-01: «если в файле очень длинные строки то у тебя должен быть перенос строк. Для
    // определения позиции». Two distinguishable halves, because «the end is reachable» must be something the
    // output can SHOW: `"x".repeat(3000)` satisfies `toContain` on any 2000-character window of itself.
    const result = await withFile("long.txt", "A".repeat(2000) + "B".repeat(1000), (p) =>
      lines(p, { limit: 10, offset: 1 }),
    )

    expect(result.raw.length).toBe(1) // ONE source line…
    expect(result.hashes.length).toBe(1) // …ONE address, because the wrap is not a second line…
    expect(result.raw[0]).toContain("↳+2000: " + "B".repeat(1000)) // …and the LAST character is reachable.
    expect(result.raw[0]).not.toContain("line truncated")
    // The true total must still be the LINE count, not the chunk count — the pager pages by source lines.
    expect(result.count).toBe(1)
  })

  // H9b. The address is a function of the TEXT, never of the bytes that carry it: every encoding `edit` can
  // write must print the same lines and the same hashes as plain UTF-8, or `edit` (which decodes through the
  // codec) refuses every address — measured for the BOM in experiments/2026-10-01_chain-review/probe.ts.
  const MULTILINGUAL = "Hello\r\nSelamat pagi\r\n你好\r\nനമസ്കാരം\r\nПривет\r\n"
  const encodings = {
    "UTF-8 BOM": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(MULTILINGUAL, "utf-8")]),
    "UTF-16 LE": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(MULTILINGUAL, "utf16le")]),
    "UTF-16 BE": Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(MULTILINGUAL, "utf16le").swap16()]),
  }
  for (const [name, encoded] of Object.entries(encodings)) {
    test(`${name} prints the SAME lines and the SAME addresses as plain UTF-8`, async () => {
      const plain = await withFile("plain.txt", MULTILINGUAL, (p) => lines(p, { limit: 10, offset: 1 }))
      const other = await withFile("other.txt", "", async (p) => {
        await writeFile(p, encoded)
        return lines(p, { limit: 10, offset: 1 })
      })

      expect(other.raw).toEqual(plain.raw)
      expect(other.raw[0]).toBe("Hello") // no U+FEFF, no NUL — the first line is text, not its carrier
      expect(other.hashes).toEqual(plain.hashes)
    })
  }

  test("an ANSI (cp1251) file reads as its TEXT in the host code page, not as U+FFFD", async () => {
    // "unit A;\nS := 'Привет';\n" — the Delphi IDE default on a 1251 host.
    const ansi = Buffer.from([...Buffer.from("unit A;\nS := '"), 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, ...Buffer.from("';\n")])
    const result = await withFile("a.pas", "", async (p) => {
      await writeFile(p, ansi)
      return lines(p, { limit: 10, offset: 1 })
    })
    const plain = await withFile("u.pas", "unit A;\nS := 'Привет';\n", (p) => lines(p, { limit: 10, offset: 1 }))

    expect(result.raw).toEqual(plain.raw)
    expect(result.hashes).toEqual(plain.hashes)
  })

  test("a chosen code page reads a legacy file as ITS text — the same lines and addresses as UTF-8 (H10)", async () => {
    const gbk = Buffer.from([0x61, 0x0a, 0xc4, 0xe3, 0xba, 0xc3, 0x0a]) // "a\n你好\n" in GBK
    const chosen = await withFile("g.txt", "", async (p) => {
      await writeFile(p, gbk)
      return lines(p, { limit: 10, offset: 1, codepage: "gbk" })
    })
    const plain = await withFile("u.txt", "a\n你好\n", (p) => lines(p, { limit: 10, offset: 1 }))

    expect(chosen.raw).toEqual(plain.raw)
    expect(chosen.hashes).toEqual(plain.hashes)
    expect(chosen.codepage).toBe("gbk")
  })

  test("a non-UTF-8 byte PAST the window still decides the encoding — the window must not", async () => {
    // Line 1 is ASCII and is the only line returned; the cp1251 byte sits on line 3. If the window decided the
    // encoding, line 1's text would be the same either way — but the TALLY would have streamed UTF-8 over a
    // file `edit` decodes as ANSI, and the two would disagree about every line past the first non-ASCII one.
    const ansi = Buffer.from([...Buffer.from("one\ntwo\n"), 0xcf, 0xf0, ...Buffer.from("\n")])
    const result = await withFile("w.pas", "", async (p) => {
      await writeFile(p, ansi)
      return lines(p, { limit: 1, offset: 1 })
    })

    expect(result.encoding).toBe("ansi")
    expect(result.count).toBe(3)
  })
})

/**
 * THE BYTE-ROW ADDRESS — the hex half of H2 (owner, 2026-10-01: «Для бинарника тоже самое»).
 *
 * A hex row is BYTES, not a text line, and three things had to be true before it could carry an address at
 * all:
 *
 *   1. the row's content must not depend on the WINDOW. Rows used to begin wherever `offset` pointed, so a
 *      read at byte 5 and a read at byte 1 disagreed about where a row STARTS — and an address computed there
 *      is a rendering of the CALL, not of the file;
 *   2. the bytes must reach a string chain intact. `latin1` is that map, and it was qualified BEFORE the code
 *      was built on it (experiments/2026-10-01_hex-address: 28 340 of 28 340 distinct rows), not after;
 *   3. the chain must run over the rows a window does NOT return, because a hash carries its whole prefix.
 *
 * The address is taken over the bytes that EXIST — never a 16-byte block padded to the window's edge, which
 * would make the last row's address depend on `limit`.
 */
describe("read — the byte-row address (hex mode)", () => {
  const bytes = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 7 + 1) & 0xff)
  const dump = (data: Uint8Array, offset: number, limit: number) =>
    formatHexDump(data, { offset, limit, maxTotalBytes: 50 * 1024 })
  // `00000020  3f19c2ea  …` — the offset column, two spaces, then the address.
  const addressOf = (result: { lines: string[] }, offset: number) =>
    result.lines.find((line) => line.startsWith(offset.toString(16).padStart(8, "0")))?.slice(10, 18)

  test("a row carries an 8-hex address, and the same bytes print the same one twice", () => {
    const first = dump(bytes(64), 1, 64)
    const second = dump(bytes(64), 1, 64)

    expect(first.lines[0]).toMatch(/^00000000 {2}[0-9a-f]{8} {2}/)
    expect(second.lines).toEqual(first.lines)
  })

  test("the WINDOW does not move a row — the prefix is chained where it is not even shown", () => {
    const data = bytes(64)

    // `offset: 40` deliberately does NOT sit on a row boundary (index 39 lives in row 32) — which is the
    // whole point. With rows aligned to `offset`, the row at 0x20 would not exist in this read at all and the
    // case would pass while proving nothing: the first version used 33, which IS index 32, a boundary.
    expect(addressOf(dump(data, 40, 16), 32)).toBeDefined()
    expect(addressOf(dump(data, 40, 16), 32)).toBe(addressOf(dump(data, 1, 64), 32))
    // The same row read from two offsets, where NEITHER sits on a row boundary.
    expect(dump(data, 5, 32).lines[0]).toBe(dump(data, 1, 32).lines[0])
  })

  test("a byte changed ABOVE a row changes the address of every row below it", () => {
    const before = dump(bytes(64), 1, 64)
    const mutated = bytes(64)
    mutated[3] = mutated[3]! ^ 0xff
    const after = dump(mutated, 1, 64)

    expect(addressOf(after, 0)).not.toBe(addressOf(before, 0))
    expect(addressOf(after, 16)).not.toBe(addressOf(before, 16))
  })

  test("rows are aligned to the FILE: `offset` names the row CONTAINING that byte, not a new start", () => {
    const result = dump(bytes(64), 5, 32)

    expect(result.offsetStart).toBe(1)
    expect(result.lines[0]!.startsWith("00000000")).toBe(true)
    // …and pagination moves by whole ROWS, or the next page would re-request a byte already delivered.
    expect(result.bytesShown % 16).toBe(0)
  })
})
