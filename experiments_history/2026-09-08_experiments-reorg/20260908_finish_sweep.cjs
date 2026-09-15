// Complete the experiments/ reorganization: sweep ALL remaining loose files
// into dated topical dirs, then verify. Canon: [ISO8601]_<topic>/
const fs = require("fs")
const path = require("path")

const ROOT = "D:/zPython/opencode/experiments"

// Loose files (last listing) grouped by topic/date inferred from names+dates.
const GROUPS = {
  // TUI rendering / vision / svg / mermaid render probes (July cluster)
  "20260707T000000Z_rendering-tools": ["Test_Svg.svg", "test-mermaid.md", "test-demo.txt", "test-doc.txt"],
  // Wire probe of video tool flow (Aug 12 cluster)
  "20260812T000000Z_gateway-wire-analysis": ["text_video_wire_probe.mjs"],
}

const entries = fs.readdirSync(ROOT, { withFileTypes: true })
const loose = entries.filter((e) => e.isFile()).map((e) => e.name)
console.log("loose before:", JSON.stringify(loose))

let moved = 0
for (const [dir, files] of Object.entries(GROUPS)) {
  const target = path.join(ROOT, dir)
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })
  for (const f of files) {
    const src = path.join(ROOT, f)
    if (!fs.existsSync(src)) {
      console.log("missing:", f)
      continue
    }
    fs.renameSync(src, path.join(target, f))
    moved++
    console.log(`moved: ${f} -> ${dir}`)
  }
}

const after = fs.readdirSync(ROOT, { withFileTypes: true })
const looseAfter = after.filter((e) => e.isFile()).map((e) => e.name)
console.log(`moved: ${moved} | loose after: ${JSON.stringify(looseAfter)}`)
console.log("\nFinal dirs:")
for (const d of after.filter((e) => e.isDirectory()).map((e) => e.name).sort()) console.log(" ", d)
