import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { renderMermaidToRgba, renderMermaidToSvg, renderSvgToRgba } from "@/util/mermaid"

// Heavy first run: mermaid WASM + resvg + font materialization.
setDefaultTimeout(30_000)

const ink = (pixels: Uint8Array, w: number, h: number) => {
  let dark = 0
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 128 && pixels[i + 1] < 128 && pixels[i + 2] < 128) dark++
  return (dark / (w * h)) * 100
}

describe("mermaid embedded font (PDF-style)", () => {
  test("text renders from the embedded font — never blank — and the raster is fast", async () => {
    const src = `flowchart LR\n  A[Client] --> B[API]\n  B --> C[DB]`
    const frame = await renderMermaidToRgba(src)
    expect(frame).not.toBeNull()
    const text = ink(frame!.data, frame!.width, frame!.height)
    // Text present (a blank font-less render measured 0.00%) and sane.
    expect(text).toBeGreaterThan(0.05)
    expect(text).toBeLessThan(5)

    // Warm raster must NOT pay the system-font scan: constructor used to cost ~230 ms
    // (paid twice per diagram via the removed probe), the whole call was 440-550 ms.
    const svg = await renderMermaidToSvg(src)
    expect(svg).not.toBeNull()
    const t0 = performance.now()
    const again = renderSvgToRgba(svg!)
    const ms = performance.now() - t0
    expect(again).not.toBeNull()
    expect(ms).toBeLessThan(150)
    console.log(`ink=${text.toFixed(2)}% raster=${Math.round(ms)}ms`)
  })
})
