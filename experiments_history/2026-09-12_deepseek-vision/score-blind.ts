// Score the blind test: model answers (from pixels) vs ground truth (computed from source).
//
// The blind test asked a model to read a 1,181-line TypeScript file that it only ever saw as
// pixels. This script compares its answers against the truth, mechanically, so the result is
// a number rather than an impression.
//
// Scoring:
//   functions  - set overlap: how many real function names the model listed, and how many it
//                invented (the two are reported separately; precision and recall)
//   constants  - same, with values compared where the value is a short literal
//   values     - exact numeric match for the two asked constants
//
// Run: bun experiments/2026-09-12_deepseek-vision/score-blind.ts

import { readFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "blind-test")
const truth = JSON.parse(readFileSync(join(DIR, "ground-truth.json"), "utf8"))
const answers = readFileSync(join(DIR, "answers.md"), "utf8")

const REAL_FUNCS: string[] = truth.funcs
const REAL_CONSTS: { name: string; value: string }[] = truth.consts
const REAL_NAMES = new Set([...REAL_FUNCS, ...REAL_CONSTS.map((c) => c.name)])

function section(layout: string, question: string): string {
  const start = answers.indexOf(`## Layout ${layout}`)
  if (start === -1) return ""
  const next = answers.indexOf("## Layout", start + 1)
  const block = answers.slice(start, next === -1 ? undefined : next)
  const q = block.indexOf(`### ${question}`)
  if (q === -1) return ""
  const end = block.indexOf("###", q + 1)
  return block.slice(q, end === -1 ? undefined : end)
}

function namesIn(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => l.replace(/^(export|function|const|type|async)\s+/g, ""))
    .map((l) => l.split(/[\s=(:,]/)[0]!)
    .filter((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n))
}

function scoreSet(found: string[], real: string[]) {
  const realSet = new Set(real)
  const foundSet = new Set(found)
  const hits = [...foundSet].filter((n) => realSet.has(n))
  const invented = [...foundSet].filter((n) => !realSet.has(n) && n.length > 2)
  const missed = [...realSet].filter((n) => !foundSet.has(n))
  return {
    found: foundSet.size,
    hits: hits.length,
    invented: invented.length,
    missed: missed.length,
    precision: foundSet.size ? Number(((100 * hits.length) / foundSet.size).toFixed(1)) : 0,
    recall: Number(((100 * hits.length) / realSet.size).toFixed(1)),
    inventedList: invented.slice(0, 12),
    missedList: missed.slice(0, 12),
  }
}

const out: string[] = []
function log(t = "") {
  out.push(t)
  console.log(t)
}

log("# Blind test score: reading code from pixels")
log("")
log(`source: ${truth.lines} lines, ${truth.chars} chars, ${REAL_FUNCS.length} functions, ${REAL_CONSTS.length} consts`)
log("")

for (const layout of ["LINES", "FLOW"]) {
  log(`## Layout ${layout}`)
  log("")

  const fnText = section(layout, "function list")
  const fnScore = scoreSet(namesIn(fnText), REAL_FUNCS)
  log(`### function names`)
  log(`- listed: ${fnScore.found}, of which real: ${fnScore.hits} (**recall ${fnScore.recall}%**)`)
  log(`- invented (not in file): ${fnScore.invented} (**precision ${fnScore.precision}%**)`)
  if (fnScore.inventedList.length) log(`- examples invented: ${fnScore.inventedList.join(", ")}`)
  if (fnScore.missedList.length) log(`- examples missed: ${fnScore.missedList.join(", ")}`)
  log("")

  const cText = section(layout, "named constants")
  const realConstNames = REAL_CONSTS.map((c) => c.name)
  const cScore = scoreSet(namesIn(cText), realConstNames)
  log(`### constant names`)
  log(`- listed: ${cScore.found}, of which real: ${cScore.hits} (**recall ${cScore.recall}%**)`)
  log(`- invented: ${cScore.invented} (**precision ${cScore.precision}%**)`)
  log("")

  // exact numeric answers for the two asked constants
  const vText = section(layout, "specific value")
  const realInterval = REAL_CONSTS.find((c) => c.name === "SUMMARY_INTERVAL_TOKENS")?.value
  const realMaxBody = REAL_CONSTS.find((c) => c.name === "MAX_SUMMARY_BODY_TOKENS")?.value
  const numOf = (s: string) => Number(s.replace(/_/g, ""))
  log(`### asked values`)
  log(`- truth: SUMMARY_INTERVAL_TOKENS=${realInterval}, MAX_SUMMARY_BODY_TOKENS=${realMaxBody}`)
  for (const name of ["SUMMARY_INTERVAL_TOKENS", "MAX_SUMMARY_BODY_TOKENS"]) {
    const m = vText.match(new RegExp(`${name}\\s*=\\s*([\\d_]+)`))
    const real = REAL_CONSTS.find((c) => c.name === name)?.value
    const got = m ? numOf(m[1]!) : undefined
    const want = real ? numOf(real) : undefined
    const ok = got !== undefined && want !== undefined && got === want
    log(`- ${name}: answered ${m?.[1] ?? "(none)"} -> **${ok ? "CORRECT" : "wrong"}**`)
  }
  log("")
}

// Cost comparison
log("## Cost")
log("")
const pages = 4
log(`- pages: ${pages} per layout`)
log(`- tokens as images: ${pages} x 963 = ${pages * 963} (measured 3,895-3,898 per question)`)
log(`- the same file as text: ${truth.chars} chars / 3.33 ~= ${Math.round(truth.chars / 3.33)} tokens`)
log(`- text/images ~= ${(truth.chars / 3.33 / (pages * 963)).toFixed(2)}x`)

const report = out.join("\n")
await Bun.write(join(DIR, "SCORE.md"), report + "\n")
console.log("")
console.log(`written to ${join(DIR, "SCORE.md")}`)
