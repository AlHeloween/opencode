// FULL experiments/ canonicalization pass 2.
// Rules:
//   dirs  -> ^\d{8}T\d{6}Z_[a-z0-9-]+$  (date from dir mtime; old date prefixes stripped, kebab-cased)
//   files -> grouped into dated topic dirs by name regex; date = file mtime
//   kept loose: README.md only (dir documentation)
//   fossil_* family merges into 20260823T000000Z_fossil-smoke
const fs = require("fs")
const path = require("path")

const ROOT = "D:/zPython/opencode/experiments"
const CANON = /^\d{8}T\d{6}Z_[a-z0-9-]+$/

const dateOf = (p) => {
  const d = fs.statSync(p).mtime
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T000000Z`
}

const kebab = (s) =>
  s.replace(/\.[^.]+$/, "") // strip ext
    .replace(/^[\d-]+[_-]?/, "") // strip leading date-ish prefixes
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()

// file name -> topic bucket (regex order matters)
const bucketOf = (name) => {
  const n = name.toLowerCase()
  if (/undo|fossil/.test(n)) return "fossil-smoke"
  if (/media|video|mp2t|mermaid|svg|render/.test(n)) return "media-render-smoke"
  if (/token_estimate|token/.test(n)) return "token-calibration"
  if (/orchestrator/.test(n)) return "orchestrator-smoke"
  if (/diffy|json_repair|json-repair|stringzilla|diff_perf/.test(n)) return "wasm-diff-bench"
  if (/deepseek/.test(n)) return "deepseek-cache-analysis"
  if (/openai_models|results_2026-07-10|model_test/.test(n)) return "model-tester"
  if (/codegraph/.test(n)) return "codegraph-smoke"
  if (/system_prompt|prompt/.test(n)) return "prompt-analysis"
  if (/cache/.test(n)) return "cache-analysis"
  if (/hf_inference|smoke_|spawn|table_sizes|test_file|fts_check|wasm_test|patch$/.test(n)) return "misc-scratch"
  return "misc-scratch"
}

const entries = fs.readdirSync(ROOT, { withFileTypes: true })
let renames = 0
let moves = 0

// ── pass 1: dirs -> canon ──
for (const e of entries.filter((x) => x.isDirectory())) {
  if (CANON.test(e.name)) continue
  const oldPath = path.join(ROOT, e.name)
  const date = dateOf(oldPath)
  // strip any leading date already embedded, then kebab
  let topic = kebab(e.name)
  // merge fossil repro family into the existing fossil-smoke dir
  if (/^fossil[_-]?repro|^fossil[_-]?replay/.test(e.name.toLowerCase())) {
    const target = path.join(ROOT, "20260823T000000Z_fossil-smoke")
    fs.mkdirSync(target, { recursive: true })
    const dest = path.join(target, e.name)
    if (!fs.existsSync(dest)) fs.renameSync(oldPath, dest)
    console.log(`dir merged: ${e.name} -> 20260823T000000Z_fossil-smoke/`)
    moves++
    continue
  }
  let newName = `${date}_${topic}`
  let newPath = path.join(ROOT, newName)
  let n = 2
  while (fs.existsSync(newPath) && newPath !== oldPath) {
    newName = `${date}_${topic}-${n++}`
    newPath = path.join(ROOT, newName)
  }
  if (newPath !== oldPath) {
    fs.renameSync(oldPath, newPath)
    console.log(`dir renamed: ${e.name} -> ${newName}`)
    renames++
  }
}

// ── pass 2: loose files -> dated topic dirs ──
const loose = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .filter((x) => x.isFile())
  .map((x) => x.name)
  .filter((n) => n !== "README.md")

for (const name of loose) {
  const src = path.join(ROOT, name)
  const date = dateOf(src)
  const topic = bucketOf(name)
  // fossil-smoke bucket has canon name already
  const dirName =
    topic === "fossil-smoke"
      ? "20260823T000000Z_fossil-smoke"
      : topic === "media-render-smoke"
        ? `${date}_media-render-smoke`
        : topic === "token-calibration"
          ? `${date}_token-calibration`
          : topic === "orchestrator-smoke"
            ? `${date}_orchestrator-smoke`
            : topic === "wasm-diff-bench"
              ? `${date}_wasm-diff-bench`
              : topic === "deepseek-cache-analysis"
                ? `${date}_deepseek-cache-analysis`
                : topic === "model-tester"
                  ? "20260710T000000Z_model-tester-x"
                  : topic === "codegraph-smoke"
                    ? `${date}_codegraph-smoke`
                    : topic === "prompt-analysis"
                      ? `${date}_prompt-analysis`
                      : topic === "cache-analysis"
                        ? `${date}_cache-analysis`
                        : `${date}_misc-scratch`
  const target = path.join(ROOT, dirName)
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })
  const dest = path.join(target, name)
  if (fs.existsSync(dest)) {
    console.log(`SKIP dup: ${name} (already in ${dirName})`)
    fs.unlinkSync(src) // identical scratch dup — remove root copy
    continue
  }
  fs.renameSync(src, dest)
  console.log(`file moved: ${name} -> ${dirName}`)
  moves++
}

// ── pass 3: normalize non-canon dates (20260710_model_tester style → canon T000000Z) ──
for (const e of fs.readdirSync(ROOT, { withFileTypes: true }).filter((x) => x.isDirectory())) {
  const m = e.name.match(/^(\d{8})T000000Z_(.+)$/)
  if (e.name.match(/^\d{8}_/) && !CANON.test(e.name)) {
    const fixed = e.name.replace(/^(\d{8})_/, "$1T000000Z_")
    const from = path.join(ROOT, e.name)
    const to = path.join(ROOT, fixed)
    if (!fs.existsSync(to)) {
      fs.renameSync(from, to)
      console.log(`dir normalized: ${e.name} -> ${fixed}`)
      renames++
    }
  }
}

// ── verify ──
const after = fs.readdirSync(ROOT, { withFileTypes: true })
const dirs = after.filter((x) => x.isDirectory()).map((x) => x.name).sort()
const files = after.filter((x) => x.isFile()).map((x) => x.name)
const bad = dirs.filter((d) => !CANON.test(d))
console.log(`\n=== DONE: ${renames} dirs renamed, ${moves} items moved ===`)
console.log(`dirs: ${dirs.length}, non-canon: ${JSON.stringify(bad)}`)
console.log(`loose files: ${JSON.stringify(files)}`)
