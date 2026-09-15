// Derive the truth for VALID questions from the map itself (not from the sources).
//
// Why this exists: the first video probe asked for the VALUE of two constants, but the
// symbol map contains no values - it carries names, kinds and line numbers only. Those two
// questions were unanswerable, so their answers were guessing, not reading, and one of them
// was even mis-scored (regex missed the decimal point). A question the artifact cannot
// answer measures the model's imagination, not its eyes.
//
// This derives questions whose answers are physically present in the map, and prints the
// ground truth mechanically so the scoring cannot drift.
//
// Run: bun experiments/2026-09-12_deepseek-vision/derive-video-truth.ts

import fs from "node:fs"
import path from "node:path"

const MAP = path.join(import.meta.dir, "symbol-map.txt")
const OUT = path.join(import.meta.dir, "video-truth.json")
// The map is written with CRLF. Splitting on "\n" alone leaves a trailing "\r" on every
// row, so an equality test against a symbol name silently never matched (the first run
// reported every symbol "absent" and a section of "0 symbols" while the rows were right
// there). Split on the real line terminator.
const lines = fs.readFileSync(MAP, "utf-8").split(/\r?\n/)

/** Map is a sequence of `@file` headers; the body lines are ` <line>  <kind> <name>`. */
function body(startIdx: number): string[] {
  let end = startIdx + 1
  while (end < lines.length && !lines[end]!.startsWith("@")) end++
  return lines.slice(startIdx + 1, end)
}

function headerIndex(file: string): number {
  return lines.findIndex((l) => l.startsWith(`@${file}`))
}

function occurrences(symbol: string): Array<{ file: string; line: string; kind: string }> {
  const found: Array<{ file: string; line: string; kind: string }> = []
  let file = ""
  for (const raw of lines) {
    const h = raw.match(/^@(.+)$/)
    if (h) {
      file = h[1]!
      continue
    }
    const m = raw.match(/^\s+(\d+)[* ]*\s+(\S+)\s+(.*)$/)
    if (m && m[3] === symbol) found.push({ file, line: m[1]!, kind: m[2]! })
  }
  return found
}

type Q = { q: string; truth: string; where: string }

// Every question below is answerable from the map's own bytes. Ambiguous ones (a symbol
// appearing more than once in a section) are rejected, so a wrong answer cannot be blamed
// on the question.

// Q1 - a line number, the class that failed before.
const est = occurrences("estimateRequestTokens")
const q1: Q = {
  q: "the line number shown for the symbol estimateRequestTokens in overflow.ts",
  truth: est.filter((o) => o.file === "overflow.ts").map((o) => o.line).join("|") || "(absent)",
  where: `map: overflow.ts section; all occurrences ${JSON.stringify(est)}`,
}

// Q2 - which file lists a symbol (a file -> symbol relation).
const ema = occurrences("EMA_ALPHA")
const q2: Q = {
  q: "the name of the file whose section lists the symbol EMA_ALPHA",
  truth: ema[0]?.file ?? "(absent)",
  where: `map: ${ema.map((o) => o.file).join(", ") || "nowhere"}`,
}

// Q3 - a count over one section (requires reading many rows, not one).
const idx = headerIndex("media-token-calibration.ts")
const symCount = body(idx).filter((l) => /^\s+\d+[* ]*\s+\S+\s+\S+/.test(l)).length
const q3: Q = {
  q: "how many symbol rows the map lists for the file media-token-calibration.ts",
  truth: String(symCount),
  where: `map: media-token-calibration.ts section`,
}

// Q4 - a relation that crosses sections: symbol -> containing file.
const tsr = occurrences("ToolStateRunning")
const q4: Q = {
  q: "the name of the file whose section lists the symbol ToolStateRunning",
  truth: tsr[0]?.file ?? "(absent)",
  where: `map: ${tsr.map((o) => `${o.file}:${o.line}`).join(", ") || "nowhere"}`,
}

const questions = [q1, q2, q3, q4]
fs.writeFileSync(OUT, JSON.stringify({ map: MAP, lines: lines.length, questions }, null, 2))
console.log(JSON.stringify({ lines: lines.length, questions }, null, 2))
