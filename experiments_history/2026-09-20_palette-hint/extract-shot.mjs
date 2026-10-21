// Extract the window screenshot that `cua get_window_state` embeds as base64 in its JSON answer,
// which the tool-output cap truncates inline (the full answer is saved to .opencode/data/tool-output/).
//
// Usage: bun experiments/2026-09-20_palette-hint/extract-shot.mjs <tool-output.json> <out.png>
//
// Why a script and not a zoom: `zoom` reads the RESIZED image space and caps a region at 500 px, so a
// full-width dialog takes several zooms; the embedded PNG is the window at native size (982 px high here),
// which is what the row/column claim needs to be judged on.
import { readFileSync, writeFileSync } from "node:fs"

const [src, out] = process.argv.slice(2)
if (!src || !out) {
  console.error("usage: extract-shot.mjs <tool-output.json> <out.png>")
  process.exit(2)
}

const text = readFileSync(src, "utf8")
let best = ""
for (const match of text.matchAll(/"(?:screenshot|image|png)[a-z_]*":\s*"([A-Za-z0-9+/=]{2000,})"/g)) {
  if (match[1].length > best.length) best = match[1]
}

if (!best) {
  console.error("no embedded base64 image found in", src)
  process.exit(1)
}

const bytes = Buffer.from(best, "base64")
writeFileSync(out, bytes)
console.log(`wrote ${out} — ${bytes.length} bytes (base64 payload ${best.length} chars)`)
