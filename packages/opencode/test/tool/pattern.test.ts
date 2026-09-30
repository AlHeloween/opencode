import { describe, expect, test } from "bun:test"
import { compilePattern, optionalPattern } from "../../src/tool/pattern"

describe("tool.pattern", () => {
  test("compiles an ordinary pattern and matches", () => {
    const re = compilePattern("foo|bar")
    expect(re.test("a bar b")).toBe(true)
    expect(re.test("nothing")).toBe(false)
  })

  test("ignoreCase is honoured", () => {
    expect(compilePattern("foo", true).test("FOO")).toBe(true)
    expect(compilePattern("foo").test("FOO")).toBe(false)
  })

  test("undefined or empty pattern means no filtering", () => {
    expect(optionalPattern(undefined)).toBeUndefined()
    expect(optionalPattern("")).toBeUndefined()
    expect(optionalPattern("x")).toBeInstanceOf(RegExp)
  })

  test("a Unicode property in the LONG form works and matches", () => {
    // The spelling that works under the `u` flag: a Script must be named as such.
    expect(compilePattern("\\p{Script=Han}").test("\u5173\u95ed")).toBe(true)
    expect(compilePattern("\\p{Script=Cyrillic}").test("\u0417\u0435\u043d")).toBe(true)
  })

  test("a Unicode property in the SHORT form is an ERROR, never an empty result", () => {
    // `\p{Han}` is invalid under `u` — `Han` is a Script, not a lone property name. The old
    // fallback recompiled the pattern WITHOUT `u`, where `\p` is just an escaped `p`, so it became
    // the literal text `p{Han}`: the pattern matched nothing and the caller was handed an empty
    // result instead of an error. A syntax mistake must never be reported as «the corpus does not
    // contain it» — that is the one failure nobody can see, and it cost a whole search cycle.
    expect(() => compilePattern("\\p{Han}")).toThrow(/p\{Han\}/)
    expect(() => compilePattern("\\p{Han}")).toThrow(/Script=/)
    expect(() => compilePattern("\\P{Cyrillic}")).toThrow(/Script=/)
  })

  test("a pattern the two engines read the SAME way still falls back", () => {
    // The fallback has a legitimate job: `a{` is an incomplete quantifier under `u` and a plain
    // literal otherwise. Only patterns whose meaning would CHANGE are refused above.
    expect(compilePattern("a{").test("a{")).toBe(true)
  })
})
