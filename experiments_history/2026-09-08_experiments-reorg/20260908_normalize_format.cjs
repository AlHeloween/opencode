// Format normalization: 20260823T000000Z_x -> 2026-08-23_x  (project canon)
// Files move into dirs by their real mtime date. README.md stays loose.
const fs = require("fs")
const path = require("path")

const ROOT = "D:/zPython/opencode/experiments"
const CANON = /^\d{4}-\d{2}-\d{2}_[a-z0-9-]+$/

const isoOf = (p) => {
  const d = fs.statSync(p).mtime
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const bucketOf = (name) => {
  const n = name.toLowerCase()
  if (/undo|fossil/.test(n)) return "fossil-smoke"
  if (/media_calibration|video|mp2t|mermaid|svg|render_text_video|render/.test(n)) return "media-render-smoke"
  if (/token_estimate/.test(n)) return "token-calibration"
  if (/orchestrator/.test(n)) return "orchestrator-smoke"
  if (/diffy|json_repair|stringzilla|diff_perf/.test(n)) return "wasm-diff-bench"
  if (/deepseek/.test(n)) return "deepseek-cache-analysis"
  if (/openai_models|results_2026-07-10/.test(n)) return "model-tester"
  if (/codegraph/.test(n)) return "codegraph-smoke"
  if (/system_prompt|prompt/.test(n)) return "prompt-analysis"
  if (/cache/.test(n)) return "cache-analysis"
  return "misc-scratch"
}

// existing dir date for a topic (reuse if the dated dir already exists)
const existingDirFor = (topic) =>
  fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((n) => n.endsWith(`_${topic}`) && CANON.test(n))

let renames = 0
let moves = 0

// pass 1: rename canon-T dirs -> project canon YYYY-MM-DD_
for (const e of fs.readdirSync(ROOT, { withFileTypes: true }).filter((x) => x.isDirectory())) {
  const m = e.name.match(/^(\d{4})(\d{2})(\d{2})T\d{6}Z_(.+)$/)
  if (!m) continue
  const [, y, mo, d, topic] = m
  const newName = `${y}-${mo}-${d}_${topic}`
  const from = path.join(ROOT, e.name)
  const to = path.join(ROOT, newName)
  if (fs.existsSync(to)) {
    console.log(`MERGE-CASE: ${e.name} exists as ${newName} — skipping rename (manual check)`)
    continue
  }
  fs.renameSync(from, to)
  console.log(`dir: ${e.name} -> ${newName}`)
  renames++
}

// pass 2: remaining non-canon dirs (tui-image-rendering may be locked — retry later)
for (const e of fs.readdirSync(ROOT, { withFileTypes: true }).filter((x) => x.isDirectory())) {
  if (CANON.test(e.name) || e.name === "tui-image-rendering") continue
  const from = path.join(ROOT, e.name)
  const newName = `${isoOf(from)}_${e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`
  const to = path.join(ROOT, newName)
  if (fs.existsSync(to)) continue
  try {
    fs.renameSync(from, to)
    console.log(`dir: ${e.name} -> ${newName}`)
    renames++
  } catch (err) {
    console.log(`LOCKED: ${e.name} (${err.code}) — left as-is`)
  }
}

// pass 3: loose files -> dated buckets
for (const name of fs.readdirSync(ROOT, { withFileTypes: true }).filter((x) => x.isFile()).map((x) => x.name)) {
  if (name === "README.md") continue
  const src = path.join(ROOT, name)
  const topic = bucketOf(name)
  const dirName = existingDirFor(topic) || `${isoOf(src)}_${topic}`
  const target = path.join(ROOT, dirName)
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })
  const dest = path.join(target, name)
  if (fs.existsSync(dest)) {
    fs.unlinkSync(src)
    console.log(`dup removed: ${name} (already in ${dirName})`)
    continue
  }
  fs.renameSync(src, dest)
  console.log(`file: ${name} -> ${dirName}`)
  moves++
}

// verify
const after = fs.readdirSync(ROOT, { withFileTypes: true })
const dirs = after.filter((x) => x.isDirectory()).map((x) => x.name).sort()
const files = after.filter((x) => x.isFile()).map((x) => x.name)
const bad = dirs.filter((d) => !CANON.test(d))
console.log(`\n=== DONE: ${renames} renames, ${moves} file moves ===`)
console.log(`dirs: ${dirs.length} | non-canon: ${JSON.stringify(bad)}`)
console.log(`loose: ${JSON.stringify(files)}`)
