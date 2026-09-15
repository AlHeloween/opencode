// Cleanup: delete repro exes (large binaries) but keep .ts/.cjs sources + probe findings.
const fs = require("fs")
const path = require("path")
const roots = [
  "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro",
  "D:/zPython/opencode/packages/opencode/dist",
]
let freed = 0
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { walk(p); continue }
    if (e.name.endsWith(".exe") && (e.name.startsWith("repro") || e.name.startsWith("cc-") || e.name.startsWith("probe_") || e.name.startsWith("bundle_") || e.name.startsWith("size_") || e.name.startsWith("d_") || e.name.startsWith("m_") || e.name.startsWith("x_") || e.name.startsWith("out_") || e.name === "compile-check.exe")) {
      freed += fs.statSync(p).size
      fs.unlinkSync(p)
      console.log("removed", p)
    }
  }
}
for (const r of roots) if (fs.existsSync(r)) walk(r)
console.log("freed", (freed / 1048576).toFixed(1), "MB")
