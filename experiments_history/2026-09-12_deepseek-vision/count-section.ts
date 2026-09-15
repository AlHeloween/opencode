// Count the rows of ONE file section, and show them, so the truth for a counting question is
// never taken from memory.
//
// This exists because I published a count of 16 for media-token-calibration.ts and the model
// answered 13. Either could be wrong, and the only way to settle it is to print the rows.
//
// Run: bun experiments/2026-09-12_deepseek-vision/count-section.ts <file>

import fs from "node:fs"
import path from "node:path"

const MAP = path.join(import.meta.dir, "symbol-map.txt")
const target = process.argv[2] ?? "media-token-calibration.ts"
const lines = fs.readFileSync(MAP, "utf-8").split(/\r?\n/)

const start = lines.findIndex((l) => l === `@${target}`)
if (start < 0) {
  console.error(`section not found: @${target}`)
  process.exit(1)
}
let end = start + 1
while (end < lines.length && !lines[end]!.startsWith("@")) end++

const rows = lines.slice(start + 1, end).filter((l) => l.trim().length > 0)
const symbolRows = rows.filter((l) => /^\s+\d+[* ]*\s+\S+\s+\S+/.test(l))
const withKind = symbolRows.map((l) => l.match(/^\s+(\d+)[* ]*\s+(\S+)\s+(.*\S)\s*$/)!)

console.log(`section @${target}: lines ${start + 1}..${end}`)
console.log(`total non-empty rows: ${rows.length}`)
console.log(`rows matching "<line> <kind> <name>": ${symbolRows.length}`)
console.log("")
console.log("idx | map line | kind | name")
for (const [i, m] of withKind.entries()) {
  console.log(`${String(i + 1).padStart(3)} | ${m[1]!.padStart(8)} | ${m[2]!.padEnd(4)} | ${m[3]}`)
}

// The section boundary can carry rows that belong to the NEXT file if the builder emitted them
// before the header. Flag any row whose line number goes backwards.
let prev = -1
const suspicious: string[] = []
for (const m of withKind) {
  const n = Number(m[1])
  if (n < prev) suspicious.push(`line ${n} after ${prev} (${m[3]})`)
  prev = n
}
console.log("")
console.log(suspicious.length ? `SUSPICIOUS ordering: ${suspicious.join("; ")}` : "ordering monotonic")
