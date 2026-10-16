import { describe, expect, test } from "bun:test"
import * as fuzzysort from "fuzzysort"

// t77 picker contract: the owner typed words like "nemotron free" and could not
// find `nemotron-3-ultra-free`. This mirrors the component's inline filter:
//   fuzzysort.go(needle, providerOptions, { keys: ["title", "category", "description"] })
// (packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx:223-227).
// DIVERGENCE 2026-10-16 (SM2): predicted FAIL, observed PASS (7/7, runs
// 20261016T161204Z_97ec1765, 20261016T161521Z_0ecfa1c6) on current catalog-shaped
// data — the single-key fuzzy DOES match multi-word queries here. The owner's miss
// is therefore NOT this code path on this data (stale provider list or different
// keystrokes; exact cause Unknown). Kept as a regression PIN: multi-word queries
// must keep matching both tokens, any order, across `-`/`/`/space.

type Row = { title: string; category?: string; description: string }

const rows: Row[] = [
  {
    title: "Nemotron 3 Ultra Free",
    category: "OpenCode",
    description: "opencode/nemotron-3-ultra-free",
  },
  {
    title: "Qwen3.6 Plus Free",
    category: "OpenCode",
    description: "opencode/qwen3.6-plus-free",
  },
  {
    title: "GPT-5.4",
    category: "OpenCode",
    description: "opencode/gpt-5.4",
  },
]

function currentFilter(needle: string): Row[] {
  return fuzzysort.go(needle, rows, { keys: ["title", "category", "description"] }).map((x) => x.obj)
}

describe("t77 picker multi-word match (contract PIN — SM2 divergence: matches on current code)", () => {
  test("nemotron free finds Nemotron 3 Ultra Free", () => {
    const hits = currentFilter("nemotron free")
    expect(hits.some((r) => r.description === "opencode/nemotron-3-ultra-free")).toBe(true)
  })

  test("reversed free nemotron finds it too", () => {
    const hits = currentFilter("free nemotron")
    expect(hits.some((r) => r.description === "opencode/nemotron-3-ultra-free")).toBe(true)
  })

  test("three tokens nemotron ultra free find it", () => {
    const hits = currentFilter("nemotron ultra free")
    expect(hits.some((r) => r.description === "opencode/nemotron-3-ultra-free")).toBe(true)
  })

  test("hyphenated token nemotron-3 free finds it", () => {
    const hits = currentFilter("nemotron-3 free")
    expect(hits.some((r) => r.description === "opencode/nemotron-3-ultra-free")).toBe(true)
  })

  test("case-insensitive NEMOTRON FREE finds it", () => {
    const hits = currentFilter("NEMOTRON FREE")
    expect(hits.some((r) => r.description === "opencode/nemotron-3-ultra-free")).toBe(true)
  })

  test("disconnected (category undefined) still finds it", () => {
    const bare = rows.map((r) => ({ title: r.title, description: r.description })) 
    const hits = fuzzysort.go("nemotron free", bare, { keys: ["title", "description"] }).map((x) => x.obj)
    expect(hits.some((r) => r.description === "opencode/nemotron-3-ultra-free")).toBe(true)
  })

  test("single token still finds it (control)", () => {
    const hits = currentFilter("nemotron")
    expect(hits.some((r) => r.description === "opencode/nemotron-3-ultra-free")).toBe(true)
  })
})
