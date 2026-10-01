import { describe, expect, test } from "bun:test"
import * as TextCodec from "../../src/util/text-codec"

/**
 * THE CODEC `read`, `edit` and `write` share (plan 2026-10-01_hash-addressed-edits, H9a).
 *
 * The property this file exists for: the three tools decode a file to the SAME text, so a hash `read` printed
 * resolves in `edit` — and nothing is ever written in an encoding that cannot hold every script. ANSI is decoded
 * and never encoded («Обратное кодирование в cp1251 сносит все мультиязычные темы», owner, 2026-10-01): the
 * output type has no ANSI member, so the compiler refuses the path rather than a test catching it.
 */

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...Buffer.from(part, "utf-8")] : part)))

// "Привет" in windows-1251 — the Delphi IDE's default «ANSI» on this host.
const CP1251_PRIVET = [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]
const MULTILINGUAL = "Hello · Selamat pagi · 你好 · നമസ്കാരം · Привет"

describe("text-codec — detection", () => {
  test("plain UTF-8 decodes as utf-8, BOM-less", () => {
    expect(TextCodec.decode(bytes("a\nb\n"), "x.txt")).toEqual({ kind: "text", encoding: "utf-8", text: "a\nb\n" })
  })

  test("a UTF-8 BOM is detected and is NOT part of the text — line 1 must hash like the BOM-less file", () => {
    expect(TextCodec.decode(bytes([0xef, 0xbb, 0xbf], "a\n"), "x.pas")).toEqual({
      kind: "text",
      encoding: "utf-8-bom",
      text: "a\n",
    })
  })

  test("UTF-16 LE and BE are detected by their BOM, before the NUL bytes could call them binary", () => {
    const le = new Uint8Array([0xff, 0xfe, ...Buffer.from(MULTILINGUAL, "utf16le")])
    const be = new Uint8Array([0xfe, 0xff, ...Buffer.from(MULTILINGUAL, "utf16le").swap16()])
    expect(TextCodec.decode(le, "x.txt")).toEqual({ kind: "text", encoding: "utf-16le", text: MULTILINGUAL })
    expect(TextCodec.decode(be, "x.txt")).toEqual({ kind: "text", encoding: "utf-16be", text: MULTILINGUAL })
  })

  test("bytes that are not UTF-8 decode as ANSI in the HOST code page", () => {
    const decoded = TextCodec.decode(bytes("S := '", CP1251_PRIVET, "';\n"), "x.pas")
    const page = TextCodec.hostCodePage()
    // Without a host code page the honest answer is a refusal — a guessed page would bake garbage into the file.
    if (page === undefined) {
      expect(decoded.kind).toBe("undecodable")
      return
    }
    expect(decoded).toEqual({ kind: "text", encoding: "ansi", codepage: page, text: expect.any(String) })
    if (page === "windows-1251") expect(decoded.kind === "text" && decoded.text).toBe("S := 'Привет';\n")
  })

  // H10. The model chooses the page — only the model can tell whether the text it reads makes sense.
  test("an explicit code page decodes a legacy file in THAT page, named by its canonical name", () => {
    const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3, 0x0a]) // "你好\n" in GBK
    expect(TextCodec.decode(gbk, "x.txt", "gbk")).toEqual({ kind: "text", encoding: "ansi", codepage: "gbk", text: "你好\n" })
    // A label the decoder knows under another spelling is reported by its canonical name.
    expect(TextCodec.codePage("cp1251")).toBe("windows-1251")
  })

  test("an unknown label, or a UTF one, is not a code page — UTF-8 would decode a legacy file to U+FFFD", () => {
    expect(TextCodec.codePage("no-such-page")).toBeUndefined()
    expect(TextCodec.codePage("utf-8")).toBeUndefined()
    expect(TextCodec.codePage("utf-16le")).toBeUndefined()
  })

  test("a chosen page never overrides what the bytes SAY — UTF-8 and BOM files ignore it", () => {
    expect(TextCodec.decode(bytes("Привет\n"), "x.txt", "gbk")).toEqual({ kind: "text", encoding: "utf-8", text: "Привет\n" })
  })

  test("a NUL byte without a BOM is binary, and so is a known binary extension", () => {
    expect(TextCodec.decode(bytes("ab", [0], "cd"), "x.txt").kind).toBe("binary")
    expect(TextCodec.decode(bytes("plain"), "x.exe").kind).toBe("binary")
  })
})

describe("text-codec — encoding out", () => {
  test("every output encoding round-trips a multilingual text exactly", () => {
    for (const encoding of ["utf-8", "utf-8-bom", "utf-16le", "utf-16be"] as const) {
      expect(TextCodec.decode(TextCodec.encode(MULTILINGUAL, encoding), "x.txt")).toEqual({
        kind: "text",
        encoding,
        text: MULTILINGUAL,
      })
    }
  })

  test("the BOM is written for utf-8-bom and the UTF-16 pair, never for utf-8", () => {
    expect([...TextCodec.encode("a", "utf-8")]).toEqual([0x61])
    expect([...TextCodec.encode("a", "utf-8-bom")]).toEqual([0xef, 0xbb, 0xbf, 0x61])
    expect([...TextCodec.encode("a", "utf-16le")]).toEqual([0xff, 0xfe, 0x61, 0x00])
    expect([...TextCodec.encode("a", "utf-16be")]).toEqual([0xfe, 0xff, 0x00, 0x61])
  })
})

describe("text-codec — the target a write must produce", () => {
  test("Delphi is ALWAYS UTF-8 BOM + CRLF, whatever it was", () => {
    for (const encoding of ["utf-8", "utf-8-bom", "utf-16le", "ansi", undefined] as const) {
      expect(TextCodec.target("Unit1.PAS", encoding)).toEqual({ encoding: "utf-8-bom", ending: "\r\n" })
    }
    expect(TextCodec.isDelphi("a/b/Project.dproj")).toBe(true)
    expect(TextCodec.isDelphi("a/b/notes.txt")).toBe(false)
  })

  test("ANSI is converted to UTF-8 BOM + CRLF; every other existing encoding is kept, its endings left alone", () => {
    expect(TextCodec.target("x.txt", "ansi")).toEqual({ encoding: "utf-8-bom", ending: "\r\n" })
    expect(TextCodec.target("x.txt", "utf-16be")).toEqual({ encoding: "utf-16be" })
    expect(TextCodec.target("x.txt", "utf-8")).toEqual({ encoding: "utf-8" })
  })
})

describe("text-codec — endings", () => {
  test("the file's ending is its MAJORITY, not the first CRLF seen", () => {
    expect(TextCodec.lineEnding("a\r\nb\nc\nd\n")).toBe("\n")
    expect(TextCodec.lineEnding("a\r\nb\r\nc\n")).toBe("\r\n")
    expect(TextCodec.lineEnding("no break")).toBeUndefined()
  })

  test("normalizeEndings rewrites both kinds, and leaves a lone CR as content", () => {
    expect(TextCodec.normalizeEndings("a\nb\r\nc\rd", "\r\n")).toBe("a\r\nb\r\nc\rd")
    expect(TextCodec.normalizeEndings("a\r\nb\n", "\n")).toBe("a\nb\n")
  })
})
