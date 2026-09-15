// Regression probe (2026-09-07): video sniffing rules after the .ts incident.
// Rules: video requires MAGIC BYTES; extension fallback never triggers video;
// native path is mp4-only; .ts text files stay text.
import fs from "fs"
import { sniffVideoMime } from "../../packages/opencode/src/util/media.ts"

function readSample(p, n = 512) {
  const fd = fs.openSync(p, "r")
  const buf = Buffer.alloc(n)
  const read = fs.readSync(fd, buf, 0, n, 0)
  fs.closeSync(fd)
  return new Uint8Array(buf.subarray(0, read))
}

const cases = [
  ["TypeScript source (the incident)", readSample("packages/opencode/src/util/media.ts")],
  ["real mp4", readSample("D:/generated_video.mp4")],
  ["mp2t container", readSample("D:/generated_video.ts")],
  ["markdown text (fallback case)", readSample("_progress_log.md")],
]

for (const [label, bytes] of cases) {
  console.log(label.padEnd(34), "->", sniffVideoMime(bytes) ?? "(no video — falls through to text/document path)")
}

// Synthetic edge cases (no real files needed):
const tsHeader = new TextEncoder().encode('import { registry } from "@/attachment/registry"\n\nconst startsWith = (bytes: Uint8Array')
console.log("synthetic .ts text".padEnd(34), "->", sniffVideoMime(tsHeader) ?? "(no video)")

// A file starting with 'G' (0x47) but NOT a valid TS packet — must NOT be video.
const gText = new TextEncoder().encode("General text file starting with G")
console.log("text starting with G".padEnd(34), "->", sniffVideoMime(gText) ?? "(no video)")

// Valid TS packet sync at 0/188/376 — must be mp2t.
const tsPkt = new Uint8Array(400)
tsPkt[0] = 0x47; tsPkt[188] = 0x47; tsPkt[376] = 0x47
console.log("synthetic TS packets".padEnd(34), "->", sniffVideoMime(tsPkt) ?? "(no video)")
