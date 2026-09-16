import { expect, test } from "bun:test"
import { Provider } from "../../src/provider/provider"
import { snapshot } from "../../src/provider/models-snapshot.js"

/**
 * One provider in the bundled catalog has no models. `defaultModelIDs` indexed
 * `[0].id` without a guard, so it threw — taking out the whole `/provider`
 * route with a 500 and an empty body, which the SDK rethrows as an envelope
 * with no fields. The TUI then failed to bootstrap saying nothing at all.
 *
 * Invisible inside a project: a repo with a cached models.json never reaches
 * the bundled snapshot. It only appears when the binary runs somewhere with no
 * project above it — which is exactly how anyone would first try it.
 */
test("a provider with no models is omitted, not a crash", () => {
  const ids = Provider.defaultModelIDs({
    good: { models: { "m-1": { id: "m-1" }, "m-2": { id: "m-2" } } },
    empty: { models: {} },
  })
  expect(ids["good"]).toBeDefined()
  expect("empty" in ids).toBe(false)
})

test("every provider is omitted rather than throwing when none have models", () => {
  expect(Provider.defaultModelIDs({ a: { models: {} }, b: { models: {} } })).toEqual({})
  expect(Provider.defaultModelIDs({})).toEqual({})
})

test("the real bundled catalog does not throw", () => {
  // The regression itself, against the actual data that produced it rather
  // than a fixture shaped like it. If the snapshot ever ships another
  // zero-model provider, this stays green — that is the point.
  const registry = snapshot as Record<string, { models?: Record<string, { id: string }> }>
  const zero = Object.keys(registry).filter((k) => Object.keys(registry[k]?.models ?? {}).length === 0)
  expect(zero.length).toBeGreaterThan(0) // the condition is real, not hypothetical
  expect(() =>
    Provider.defaultModelIDs(registry as Record<string, { models: Record<string, { id: string }> }>),
  ).not.toThrow()
})
