#!/usr/bin/env bun
/**
 * Pixel + decode oracle for the RE-BASED opentui lib (2026-09-21).
 *
 * WHY not the TUI: the project DB is `getProjectDbPath(worktree) = {worktree}/.opencode/data/opencode.db`
 * and `worktree` is the git root of the cwd (storage/db.ts:44, project.ts:350). The TUI only starts with
 * the cwd at `packages/opencode` (otherwise the screen stays blank — measured twice), so a TUI run inside
 * this repo opens the DEVELOPER'S real database. `OPENCODE_DB` does not move it (it maps to
 * `paths.dbPath`, config.ts:1240). So the oracle tests the LIBRARY directly — exactly what the re-base
 * swapped — on real image bytes, in a real terminal.
 *
 * Three claims, in the order the app needs them:
 *   1. the renderer binds the protocol (forced sixel, the path the app's MediaImage uses);
 *   2. `NativeImage.load` DECODES webp — the codec the pre-rebase fork could not decode (jimp refuses
 *      webp; the app carried a sharp bridge because of it);
 *   3. `NativeImage.fromRgba` + ImageRenderable PAINT pixels — the same call the app makes, with a
 *      structured gradient so the capture is checkable by eye rather than by trust.
 * Everything lands in oracle-result.json, because the ConPTY log comes back empty (`bytes_written: 0`).
 */
import { writeFileSync } from "node:fs"
import { createCliRenderer } from "../../packages/opentui/packages/core/src/index.js"
import { TextRenderable } from "../../packages/opentui/packages/core/src/renderables/Text.js"
import { ImageRenderable } from "../../packages/opentui/packages/core/src/renderables/Image.js"
import { NativeImage } from "../../packages/opentui/packages/core/src/image.js"

const here = import.meta.dir
const FIXTURES = "D:/zPython/opencode/packages/opentui/packages/core/src/tests/fixtures/images"
const CHECKS: Array<Record<string, unknown>> = []

const renderer = await createCliRenderer()
const forced = renderer.setImageProtocol("sixel")
CHECKS.push({ check: "setImageProtocol(sixel)", ok: forced === true, reported: renderer.capabilities?.image_protocol })

// (2) decode: webp is the codec the old fork lacked.
let webp: NativeImage | undefined
try {
  webp = await NativeImage.load(`${FIXTURES}/alpha.webp`)
  CHECKS.push({ check: "decode alpha.webp", ok: true, width: webp.width, height: webp.height })
} catch (error) {
  CHECKS.push({ check: "decode alpha.webp", ok: false, error: String(error) })
}

// (3) paint: a structured gradient built in memory — the app's own route is NativeImage.fromRgba.
const W = 240
const H = 120
const pixels = new Uint8Array(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const band = Math.floor(x / (W / 6))
    pixels[i] = band % 2 === 0 ? 255 : Math.round((x / W) * 255) // R
    pixels[i + 1] = Math.round((y / H) * 255) // G
    pixels[i + 2] = band % 2 === 0 ? 64 : 255 - Math.round((x / W) * 255) // B
    pixels[i + 3] = 255
  }
}
const gradient = NativeImage.fromRgba(pixels, W, H)
CHECKS.push({ check: "NativeImage.fromRgba", ok: true, width: gradient.width, height: gradient.height })

renderer.root.add(
  new TextRenderable(renderer, {
    id: "oracle-title",
    content: `graphics oracle — re-based opentui · protocol=${renderer.capabilities?.image_protocol} · ${CHECKS.map((c) => `${c.check}=${c.ok}`).join(" ")}`,
  }),
)
renderer.root.add(new ImageRenderable(renderer, { id: "oracle-gradient", source: gradient, width: 60, height: 24 }))
if (webp) renderer.root.add(new ImageRenderable(renderer, { id: "oracle-webp", source: webp, width: 12, height: 6 }))

writeFileSync(`${here}/oracle-result.json`, JSON.stringify({ cellSize: renderer.cellSize ?? null, checks: CHECKS }, null, 2))
renderer.requestRender()
await Bun.sleep(150_000)
renderer.destroy()
process.exit(0)
