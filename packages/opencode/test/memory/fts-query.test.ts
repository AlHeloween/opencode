import { describe, expect, test } from "bun:test"
import { toFtsQuery } from "../../src/memory/memory"

describe("toFtsQuery", () => {
  // The defect this exists for, measured: `re-base opentui` reached FTS5 verbatim and the
  // server answered `no such column: base` — the hyphen was read as FTS5 syntax.
  test("a hyphenated project term survives as a literal phrase", () => {
    expect(toFtsQuery("re-base opentui")).toBe('"re-base" "opentui"')
  })

  test("column-filter and operator syntax is neutralised, not honoured", () => {
    expect(toFtsQuery("role:user OR NOT base")).toBe('"role:user" "OR" "NOT" "base"')
  })

  test("embedded quotes are doubled, so the phrase stays balanced", () => {
    expect(toFtsQuery('say "hi"')).toBe('"say" """hi"""')
  })

  test("blank input yields an empty expression the caller refuses", () => {
    expect(toFtsQuery("   ")).toBe("")
  })
})
