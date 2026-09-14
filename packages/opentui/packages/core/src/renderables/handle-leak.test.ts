import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { TextRenderable } from "./Text.js"
import { BoxRenderable } from "./Box.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { nativeHandleCensus } from "../zig.js"

/**
 * `handles.zig` is ONE table of 65_535 slots shared by every native object kind,
 * and `vacateSlot` retires a slot permanently once its 12-bit generation counter
 * saturates — the pool only ever shrinks. So a leak in any kind eventually throws
 * `Failed to create TextBuffer` at whatever allocates next, which is what the TUI
 * did on 2026-09-14T04:19:10Z, ~5s into a streaming turn.
 *
 * Reading the code found no leak: the solid reconciler tears down with
 * `destroyRecursively`, `measureSnapshotHeight` balances its root in a `finally`,
 * and `Markdown.ts` destroys before every replace. These probes drive the two
 * shapes a streaming turn actually produces and watch the census instead.
 */
function live(): Record<string, number> {
  return Object.fromEntries(
    nativeHandleCensus()
      .split(" ")
      .filter(Boolean)
      .map((entry) => {
        const [kind, counts] = entry.split("=")
        return [kind, Number(counts.split("/")[0])]
      }),
  )
}

function delta(before: Record<string, number>, after: Record<string, number>) {
  return Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .map((kind) => [kind, (after[kind] ?? 0) - (before[kind] ?? 0)] as const)
      .filter(([, d]) => d !== 0),
  )
}

let renderer: TestRenderer
let renderOnce: () => Promise<void>

describe("native handle table", () => {
  beforeEach(async () => {
    ;({ renderer, renderOnce } = await createTestRenderer({ width: 40, height: 10 }))
  })

  afterEach(() => {
    renderer.destroy()
  })

  it("does not grow while one renderable streams content, the shape of a reasoning turn", async () => {
    const text = new TextRenderable(renderer, { left: 0, top: 0, content: "" })
    renderer.root.add(text)
    await renderOnce()

    const before = live()
    let buffer = ""
    for (let i = 0; i < 400; i++) {
      buffer += `delta ${i} `
      text.content = buffer
      await renderOnce()
    }
    const after = live()

    expect(delta(before, after)).toEqual({})
  })

  it("returns every handle when children are mounted and destroyed in a cycle", async () => {
    // Warm-up cycle first: the very first mount can allocate lazily-created
    // shared objects that are not part of the steady state.
    const warm = new BoxRenderable(renderer, {})
    warm.add(new TextRenderable(renderer, { content: "warm" }))
    renderer.root.add(warm)
    await renderOnce()
    warm.destroyRecursively()
    await renderOnce()

    const before = live()
    for (let i = 0; i < 200; i++) {
      const box = new BoxRenderable(renderer, {})
      box.add(new TextRenderable(renderer, { content: `part ${i}` }))
      renderer.root.add(box)
      await renderOnce()
      box.destroyRecursively()
      await renderOnce()
    }
    const after = live()

    expect(delta(before, after)).toEqual({})
  })
})
