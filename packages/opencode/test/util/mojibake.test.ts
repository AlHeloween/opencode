/**
 * Mojibake guard (plan 2026-10-14_progress-log-mojibake, T4).
 *
 * WHY this exists: on 2026-10-12 `_progress_log.md` was rewritten once with the
 * UTF-8 bytes read as cp1251 — 2 521 lines turned into `вЂ”`/`РЅРµ` and every
 * reader saw garbage. The damage is silent: valid UTF-8, valid CRLF, no tool
 * complains. This guard is the alarm that was missing.
 *
 * PREDICATE (the same round trip the repair census used): a line is damaged iff
 * it carries a non-ASCII character, every character maps back to windows-1251
 * (including byte 0x98 -> U+0098, which only the WHATWG table defines), and
 * decoding those bytes as UTF-8 succeeds AND yields different text.
 *
 * A genuinely Russian file does not trip it: its characters DO round-trip
 * through cp1251, but the bytes are not valid UTF-8, or decode to itself.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "fs"
import * as path from "path"

// The whole-file scan reads ~5 000 tracked files; give it room (AGENTS: a heavy
// test file carries a FILE-level timeout, never a per-test one).
setDefaultTimeout(60_000)

const CP1251_TO_BYTE = (() => {
  const decoder = new TextDecoder("windows-1251")
  const map = new Map<string, number>()
  for (let b = 0x80; b <= 0xff; b++) {
    const ch = decoder.decode(new Uint8Array([b]))
    if (!map.has(ch)) map.set(ch, b)
  }
  return map
})()

/** windows-1251 bytes for a string, or undefined when some char has no byte. */
function encodeCp1251(s: string): Uint8Array | undefined {
  const out: number[] = []
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (cp < 0x80) {
      out.push(cp)
      continue
    }
    const byte = CP1251_TO_BYTE.get(ch)
    if (byte === undefined) return undefined
    out.push(byte)
  }
  return new Uint8Array(out)
}

/** Line numbers (1-based) of round-trip-repairable mojibake lines. */
export function mojibakeLines(text: string): number[] {
  const utf8 = new TextDecoder("utf-8", { fatal: true })
  const hits: number[] = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw
    if (!/[^\x00-\x7f]/.test(line)) continue
    const bytes = encodeCp1251(line)
    if (bytes === undefined) continue
    try {
      if (utf8.decode(bytes) !== line) hits.push(i + 1)
    } catch {
      // not valid UTF-8 through the cp1251 round trip: not this damage class
    }
  }
  return hits
}

const EXTENSIONS = new Set([".md", ".ts", ".py", ".cmd", ".ps1", ".json"])

describe("mojibake guard — the predicate", () => {
  test("a fixture with one damaged line is reported (and decodes to the clean text)", () => {
    // The damaged line is BUILT, never hand-typed: taking the clean text's
    // UTF-8 bytes and reading them as windows-1251 is exactly the accident.
    const cleanLine = "\u2014 \u043d\u0435 \u0441\u0440\u0435\u0434" // "— не сред"
    const damagedLine = new TextDecoder("windows-1251").decode(new TextEncoder().encode(cleanLine))
    const damaged = `# Title\nhealthy ASCII line\n${damagedLine}\n`
    expect(damagedLine).not.toBe(cleanLine)
    expect(mojibakeLines(damaged)).toEqual([3])
    const bytes = encodeCp1251(damagedLine)!
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(cleanLine)
  })

  test("clean Russian, English and real typography are NOT reported", () => {
    const clean = "# Заголовок\nздоровый русский текст — тире, «кавычки», ✓ галка\nplain english\n"
    expect(mojibakeLines(clean)).toEqual([])
  })

  test("a line outside cp1251 is not this damage class", () => {
    // U+1F600 has no cp1251 byte: the round trip cannot even be attempted.
    expect(mojibakeLines("emoji \u{1f600} line\n")).toEqual([])
  })
})

describe("mojibake guard — the repository", () => {
  const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"])
  const root = (top.stdout?.toString() ?? "").trim()

  test.skipIf(root === "")("every tracked text file is free of this damage", () => {
    const ls = Bun.spawnSync(["git", "ls-files"], { cwd: root })
    const files = (ls.stdout?.toString() ?? "")
      .split("\n")
      .filter((f) => f.length > 0 && EXTENSIONS.has(path.extname(f).toLowerCase()))

    const failures: string[] = []
    for (const f of files) {
      const buf = fs.readFileSync(path.join(root, f))
      let text: string
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buf)
      } catch {
        continue // not UTF-8 text (e.g. a binary asset behind a text extension)
      }
      const hits = mojibakeLines(text)
      if (hits.length > 0) failures.push(`${f}: lines ${hits.slice(0, 3).join(", ")}${hits.length > 3 ? " …" : ""}`)
    }
    expect(failures).toEqual([])
  })
})
