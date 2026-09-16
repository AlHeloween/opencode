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
  // The regression against the actual data rather than a fixture shaped like
  // it. When this was written the snapshot DID ship a zero-model provider
  // (streamlake-vanchin) and that assertion was part of the test; the
  // catalogue has since been populated from 32 live-verified ids, so the
  // trigger is gone from the data as well. The guard stays either way — a
  // catalog is external input and the next sync can reintroduce the shape.
  const registry = snapshot as Record<string, { models?: Record<string, { id: string }> }>
  expect(() =>
    Provider.defaultModelIDs(registry as Record<string, { models: Record<string, { id: string }> }>),
  ).not.toThrow()
  expect(Object.keys(Provider.defaultModelIDs(registry as never)).length).toBeGreaterThan(200)
})

test("streamlake-vanchin ships the catalogue it is callable with", () => {
  // Every id here answered a live max_tokens:1 call on 2026-09-16. Names the
  // provider so a future sync that empties it fails loudly rather than
  // silently reverting to "authenticate first, then guess your endpoint".
  const registry = snapshot as Record<string, { models?: Record<string, { id: string }> }>
  const models = Object.keys(registry["streamlake-vanchin"]?.models ?? {})
  expect(models.length).toBeGreaterThan(25)
  expect(models).toContain("glm-5.3-flash")
  expect(models).toContain("deepseek-v4-flash")
  // Measured as UnavailableModel / EndpointNotFound — bundling them would
  // offer models the gateway refuses.
  expect(models).not.toContain("kat-coder-pro-v2.5")
  expect(models).not.toContain("deepseek-r1-0528")
})
