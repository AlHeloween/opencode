// Rewrite a .cmd with CRLF line endings.
//
// WHY THIS EXISTS: a .cmd file written with LF-only endings is parsed as garbage by cmd.exe —
// labels and quoted arguments split mid-token, producing errors like «'alette-hint' is not
// recognized as an internal or external command». That is what made this sandbox launcher exit
// 1 with a blank window twice before the cause was named (2026-09-20).
//
// Run: bun experiments/2026-09-20_palette-hint/fix-eol.mjs
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, "_run.cmd")
const text = readFileSync(target, "utf8")
const crlf = text.replace(/\r?\n/g, "\r\n")
writeFileSync(target, crlf, "utf8")
console.log("rewrote", target, "LF ->", "CRLF", "bytes:", crlf.length)
