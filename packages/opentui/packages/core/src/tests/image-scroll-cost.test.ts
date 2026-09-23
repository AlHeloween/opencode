// T9 of plans/2026-09-22_reasoning-stream-render-stability.md — what an on-screen sixel image costs per
// frame while a sticky-bottom ScrollBox streams lines past it.
//
// The audit (code-read only) predicts, from renderer.zig:1871-1896 and renderer.zig:162-174 +
// buffer.zig:2581-2603:
//   visible + moving  -> the WHOLE cached payload is re-sent every frame (position is in the dirty check)
//   clipped + moving  -> a NEW payload every frame (the clipped source rect is in the cache key)
//   out of view       -> nothing
//   static            -> nothing, even while other cells change
// This file MEASURES that: one continuous stream walks the image through visible -> clipped -> out, and
// a static phase changes only the bottom line. The assertions are instrument health (the controls must read
// zero, the geometry must produce every phase, the image must be seen at all); the cost table is printed
// and recorded in the plan, so a fix (T10/T12) moves the numbers without having to rewrite this file.

import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { NativeImage } from "../image.js"
import { CliRenderEvents, createCliRenderer, type CliRenderer } from "../renderer.js"
import { ImageRenderable } from "../renderables/Image.js"
import { ScrollBoxRenderable } from "../renderables/ScrollBox.js"
import { TextRenderable } from "../renderables/Text.js"
import { createTestStdin, TestWriteStream } from "../testing/test-streams.js"

setDefaultTimeout(20_000)

const COLS = 40
const ROWS = 20
const CELL_W = 10
const CELL_H = 20
const IMAGE_COLS = 8
const IMAGE_ROWS = 6
const LINES_ABOVE = 10
const LINES_BELOW = ROWS - LINES_ABOVE - IMAGE_ROWS
const STREAM_STEPS = 30
const STATIC_STEPS = 4

class CapturingStdout extends TestWriteStream {
  readonly writes: Buffer[] = []

  override _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.writes.push(Buffer.from(chunk))
    callback()
  }

  take(): string {
    const output = Buffer.concat(this.writes).toString("binary")
    this.writes.length = 0
    return output
  }
}

function flushWritable(stdout: NodeJS.WritableStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stdout.write(Buffer.alloc(0), (error) => (error ? reject(error) : resolve()))
  })
}

/** A non-uniform picture, so a crop really changes the encoded bytes. */
function gradient(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = Math.round((x / width) * 255)
      data[i + 1] = Math.round((y / height) * 255)
      data[i + 2] = (x * 7 + y * 13) % 256
      data[i + 3] = 255
    }
  }
  return data
}

/** Sixel DCS bodies only (`ESC P <params> q … ESC \`); other DCS strings (queries) are not images. */
function sixelPayloads(output: string): string[] {
  const payloads: string[] = []
  let at = output.indexOf("\x1bP")
  while (at !== -1) {
    const end = output.indexOf("\x1b\\", at + 2)
    if (end === -1) break
    const body = output.slice(at + 2, end)
    if (/^[\d;]*q/.test(body)) payloads.push(body)
    at = output.indexOf("\x1bP", end + 2)
  }
  return payloads
}

type Kind = "visible" | "clipped" | "out" | "static"

type FrameRecord = {
  step: number
  kind: Kind
  y: number
  frames: number
  bytes: number
  dcs: number
  payloadBytes: number
  resent: number
  reencoded: number
  ms: number
}

let renderer: CliRenderer | undefined

afterEach(() => {
  renderer?.destroy()
  renderer = undefined
})

test("image cost per frame while a sticky-bottom ScrollBox streams past it (T9)", async () => {
  const stdin = createTestStdin()
  const stdout = new CapturingStdout(COLS, ROWS) as CapturingStdout & NodeJS.WriteStream
  renderer = await createCliRenderer({ stdin, stdout, consoleMode: "disabled" })
  const active = renderer
  let frameEvents = 0
  active.on(CliRenderEvents.FRAME, () => frameEvents++)

  // Pixel geometry: CSI 4 ; height ; width t — sixel needs it to size the placement.
  stdin.emit("data", Buffer.from(`\x1b[4;${ROWS * CELL_H};${COLS * CELL_W}t`))

  const scroll = new ScrollBoxRenderable(active, {
    width: "100%",
    height: "100%",
    stickyScroll: true,
    stickyStart: "bottom",
  })
  active.root.add(scroll)

  const lines: TextRenderable[] = []
  const addLine = (content: string) => {
    const line = new TextRenderable(active, { content, flexShrink: 0 })
    scroll.add(line)
    lines.push(line)
    return line
  }

  for (let i = 0; i < LINES_ABOVE; i++) addLine(`above ${i}`)
  const image = new ImageRenderable(active, {
    width: IMAGE_COLS,
    height: IMAGE_ROWS,
    fit: "fill",
    protocol: "sixel",
    flexShrink: 0,
  })
  scroll.add(image)
  // The caller owns its reference and must dispose it (skill: components/text-display.md:305-306).
  const source = NativeImage.fromRgba(gradient(IMAGE_COLS * CELL_W, IMAGE_ROWS * CELL_H), IMAGE_COLS * CELL_W, IMAGE_ROWS * CELL_H)
  image.source = source
  source.dispose()
  await image.loadPromise
  for (let i = 0; i < LINES_BELOW; i++) addLine(`below ${i}`)
  const tail = lines[lines.length - 1]!

  let lastPayload: string | undefined
  const records: FrameRecord[] = []

  const measure = async (step: number, kind: Kind | undefined, mutate: () => void) => {
    const before = frameEvents
    const t0 = performance.now()
    mutate()
    active.requestRender()
    await active.idle()
    await flushWritable(stdout)
    const ms = performance.now() - t0
    const output = stdout.take()
    const payloads = sixelPayloads(output)
    let resent = 0
    let reencoded = 0
    for (const payload of payloads) {
      if (payload === lastPayload) resent++
      else reencoded++
      lastPayload = payload
    }
    const y = image.y
    const resolved: Kind =
      kind ?? (y >= 0 && y + IMAGE_ROWS <= ROWS ? "visible" : y < 0 && y + IMAGE_ROWS > 0 ? "clipped" : "out")
    records.push({
      step,
      kind: resolved,
      y,
      frames: frameEvents - before,
      bytes: output.length,
      dcs: payloads.length,
      payloadBytes: payloads.reduce((sum, payload) => sum + payload.length, 0),
      resent,
      reencoded,
      ms,
    })
  }

  // Step 0: first paint. Everything fits the viewport, nothing has scrolled yet.
  await measure(0, "visible", () => {})
  const first = records[0]!

  // Static phase: only the bottom line changes (a spinner-like tick). The image does not move.
  for (let i = 1; i <= STATIC_STEPS; i++) {
    await measure(i, "static", () => {
      tail.content = `below tick ${i}`
    })
  }

  // Stream phase: one appended line per frame; sticky-bottom moves everything up one row.
  for (let i = 1; i <= STREAM_STEPS; i++) {
    await measure(STATIC_STEPS + i, undefined, () => {
      addLine(`stream ${i}`)
    })
  }

  console.log("step kind     y   frames bytes  dcs payload resent reenc  ms")
  for (const r of records) {
    console.log(
      [
        String(r.step).padStart(4),
        r.kind.padEnd(8),
        String(r.y).padStart(3),
        String(r.frames).padStart(6),
        String(r.bytes).padStart(6),
        String(r.dcs).padStart(4),
        String(r.payloadBytes).padStart(7),
        String(r.resent).padStart(6),
        String(r.reencoded).padStart(5),
        r.ms.toFixed(2).padStart(6),
      ].join(" "),
    )
  }

  const byKind = (kind: Kind) => records.filter((r) => r.kind === kind && r.step > 0)
  const summary = (kind: Kind) => {
    const rows = byKind(kind)
    const n = rows.length || 1
    return {
      frames: rows.length,
      withImage: rows.filter((r) => r.dcs > 0).length,
      resent: rows.reduce((s, r) => s + r.resent, 0),
      reencoded: rows.reduce((s, r) => s + r.reencoded, 0),
      avgBytes: Math.round(rows.reduce((s, r) => s + r.bytes, 0) / n),
      avgMs: Number((rows.reduce((s, r) => s + r.ms, 0) / n).toFixed(2)),
    }
  }
  for (const kind of ["static", "visible", "clipped", "out"] as const) {
    console.log(`summary ${kind}: ${JSON.stringify(summary(kind))}`)
  }

  // Instrument health. (1) The image is seen at all: the first paint emits it.
  expect(first.dcs).toBeGreaterThan(0)
  // (2) The geometry walks the image through every phase this file exists to compare.
  expect(byKind("visible").length).toBeGreaterThanOrEqual(5)
  expect(byKind("clipped").length).toBeGreaterThanOrEqual(3)
  expect(byKind("out").length).toBeGreaterThanOrEqual(3)
  // (3) Control D: frames DID happen in the static phase, and a non-moving image emitted nothing.
  expect(byKind("static").every((r) => r.frames > 0)).toBe(true)
  expect(byKind("static").every((r) => r.dcs === 0)).toBe(true)
  // (4) Control A: once fully out of view (after the frame it left on), nothing is emitted.
  expect(byKind("out").slice(1).every((r) => r.dcs === 0)).toBe(true)
})
