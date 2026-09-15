// Find HOW the kernel string is stored in d_baseline.exe: search with a
// flexible scan around known words; dump raw bytes near a hit of 'WORKFLOW'.
const fs = require("fs")
const buf = fs.readFileSync("D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro/cyc/d_baseline.exe")
const latin = buf.toString("latin1")
// find all 'WORKFLOW' occurrences with context
let idx = latin.indexOf("WORKFLOW")
let shown = 0
while (idx !== -1 && shown < 4) {
  const start = Math.max(0, idx - 60)
  const ctx = buf.subarray(start, idx + 60)
  console.log(`@${idx}:`, JSON.stringify(ctx.toString("latin1")))
  shown++
  idx = latin.indexOf("WORKFLOW", idx + 1)
}
// how is 'gates:' stored? try the char AFTER 'gates'
idx = latin.indexOf("gates:")
while (idx !== -1 && shown < 8) {
  const ctx = buf.subarray(idx - 20, idx + 40)
  console.log(`gates @${idx}:`, JSON.stringify(ctx.toString("latin1")))
  shown++
  idx = latin.indexOf("gates:", idx + 1)
}
// maybe UTF-16? check 'W\0O\0R\0K'
const utf16 = latin.includes("W\x00O\x00R\x00K")
console.log("utf16 LE 'WORK':", utf16)
