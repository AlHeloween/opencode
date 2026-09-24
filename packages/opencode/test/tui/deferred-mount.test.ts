// T11b step 4 of plans/to_be_confirmed/2026-09-22_reasoning-stream-render-stability.md — the bottom-up mount policy.
import { expect, test } from "bun:test"
import { deferredOnEntry, nextSlice } from "../../src/cli/cmd/tui/routes/session/deferred-mount"

const items = (sizes: number[]) => sizes.map((chars, i) => ({ id: `m${i}`, chars }))

test("the newest messages stay eager until the budget is covered; the older rest is deferred newest-first", () => {
  // m0 (oldest) … m5 (newest); 1 000 chars each, budget 2 500 → m5, m4, m3 eager.
  expect(deferredOnEntry(items([1000, 1000, 1000, 1000, 1000, 1000]), 2500, 1)).toEqual(["m2", "m1", "m0"])
})

test("at least minEager messages stay eager even when the newest alone covers the budget", () => {
  expect(deferredOnEntry(items([10, 10, 10, 50_000]), 2500, 2)).toEqual(["m1", "m0"])
})

test("a session that fits the budget defers nothing, and an empty one defers nothing", () => {
  expect(deferredOnEntry(items([100, 200, 300]), 2500, 1)).toEqual([])
  expect(deferredOnEntry([], 2500, 1)).toEqual([])
})

test("a slice takes ids newest-first up to the char budget, always at least one", () => {
  const sizes = new Map([
    ["a", 10_000],
    ["b", 10_000],
    ["c", 10_000],
    ["huge", 90_000],
  ])
  const charsOf = (id: string) => sizes.get(id) ?? 0
  expect(nextSlice(["a", "b", "c"], charsOf, 15_000)).toEqual({ release: ["a", "b"], rest: ["c"] })
  // A single message larger than the slice is still released on its own — the walk cannot stall.
  expect(nextSlice(["huge", "a"], charsOf, 15_000)).toEqual({ release: ["huge"], rest: ["a"] })
  expect(nextSlice([], charsOf, 15_000)).toEqual({ release: [], rest: [] })
})
