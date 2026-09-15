// Minimal repro: does Bun compile inline .txt imports as text or emit file assets?
// Context: build.ts:233 "binary missing inlined reasoning kernel" — probe of the
// real exe showed ALL 56 .txt assets stored as BunFS files (reasoning_prompt-h85pmwd2.txt
// in the asset table), content absent. Bun version moved 1.4.0 -> 1.4.2 recently.
//
// Usage: bun experiments/2026-09-08_bun-txt-embed-repro/repro.ts && node probe-bin.cjs
import txt from "./content.txt"
console.log("type:", typeof txt)
console.log("len:", typeof txt === "string" ? txt.length : "n/a")
console.log("first 80:", typeof txt === "string" ? JSON.stringify(txt.slice(0, 80)) : JSON.stringify(txt))
console.log("is path stub:", typeof txt === "string" && txt.includes("~BUN/"))
