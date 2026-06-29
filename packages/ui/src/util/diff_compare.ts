import { diffLinesSync } from "./diff-wasm"
import { parseDiffFromFile } from "@pierre/diffs"

const cases: [string, string, string][] = [
  ["identical", "a\nb\nc", "a\nb\nc"],
  ["insert_mid", "a\nb", "a\nc\nb"],
  ["delete_mid", "a\nb\nc", "a\nc"],
  ["modify", "line1\nold\nline3", "line1\nnew\nline3"],
  ["empty_old", "", "new\nlines"],
  ["empty_new", "old\nlines", ""],
  ["multiline", "a\nb\nc\nd\ne", "a\nx\nc\ny\ne"],
]

// Wait for WASM to load (it's async at import time)
await new Promise(r => setTimeout(r, 500))

let ok = 0, fail = 0
for (const [name, before, after] of cases) {
  const wasm = diffLinesSync(before, after)
  if (!wasm) { console.log(name + ": SKIP"); continue }
  const pierre = parseDiffFromFile({ name: "t", contents: before }, { name: "t", contents: after })
  const match =
    wasm.deletionLines.join("\n") === (pierre.deletionLines ?? []).join("\n") &&
    wasm.additionLines.join("\n") === (pierre.additionLines ?? []).join("\n")
  console.log(name + ": " + (match ? "MATCH" : "MISMATCH"))
  if (match) ok++; else fail++
}
console.log(ok + " match, " + fail + " mismatch")
