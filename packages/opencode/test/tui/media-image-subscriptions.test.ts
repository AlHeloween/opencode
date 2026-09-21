/**
 * The capabilities subscription is per RENDERER, not per element.
 *
 * Regression pin for the defect Node reported on the 2026-09-21 build, verbatim:
 *
 *   MaxListenersExceededWarning: Possible EventEmitter memory leak detected.
 *   11 capabilities listeners added to [VH]. MaxListeners is 10.
 *
 * The renderer is shared by every media element in the conversation, and `MediaImage` used to
 * register its own handler in the component body. Eleven images/diagrams therefore put eleven live
 * handlers on one emitter — and because each handler runs `pipeline()`, ONE capabilities event
 * fanned out into eleven concurrent renders. A warning about listeners was also a warning about
 * eleven mermaid WASM renders racing on the same frame buffers.
 */
import { expect, test } from "bun:test"
import { subscribeCapabilities } from "../../src/cli/cmd/tui/component/media-image"

function fakeRenderer() {
  const handlers: Array<() => void> = []
  return {
    renderer: {
      on: (_event: unknown, fn: () => void) => {
        handlers.push(fn)
      },
    } as never,
    handlers,
    fire: () => handlers.forEach((handler) => handler()),
  }
}

test("eleven media elements put ONE capabilities listener on the shared renderer", () => {
  const fake = fakeRenderer()
  const fires: number[] = []

  const offs = Array.from({ length: 11 }, (_, i) => subscribeCapabilities(fake.renderer, () => fires.push(i)))

  // The defect: this was 11.
  expect(fake.handlers.length).toBe(1)

  // …and the per-element semantics survive: one event still reaches every mounted element,
  // which is what the 2026-09-21 media repair needs in order to re-attempt its own pipeline.
  fake.fire()
  expect(fires).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

  // Unmounting every element drains the fan-out, so a later event has nobody to call.
  offs.forEach((off) => off())
  fake.fire()
  expect(fires.length).toBe(11)
  // The renderer keeps its single handler: it outlives the elements, so one registration cannot leak.
  expect(fake.handlers.length).toBe(1)
})

test("a second renderer gets its own single listener", () => {
  const a = fakeRenderer()
  const b = fakeRenderer()
  const seen: string[] = []

  const offA = subscribeCapabilities(a.renderer, () => seen.push("a"))
  const offB = subscribeCapabilities(b.renderer, () => seen.push("b"))

  expect(a.handlers.length).toBe(1)
  expect(b.handlers.length).toBe(1)

  a.fire()
  expect(seen).toEqual(["a"])

  offA()
  offB()
})
