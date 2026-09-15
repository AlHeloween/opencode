// Deep scan of cc-s0m0.exe (no splitting): where did BOTH strings go?
// Try: (a) raw ASCII, (b) escaped \uXXXX sequences, (c) utf8 high bytes.
const fs = require("fs")
const pkg = "D:/zPython/opencode/packages/opencode"
const latin = fs.readFileSync(pkg + "/dist/cc-s0m0.exe").toString("latin1")
console.log("size:", latin.length)
console.log("raw 'G0: UNDERSTAND':", latin.includes("G0: UNDERSTAND"))
console.log("raw 'gates:':", latin.includes("gates:"))
console.log("raw 'Use this tool when you need to ask':", latin.includes("Use this tool when you need to ask"))
console.log("esc 'G0: UNDERSTAND' variants:")
for (const needle of [
  "G0\\x3a UNDERSTAND", "G0\\u003a UNDERSTAND", "G\\x30: UNDERSTAND",
  "UNDERSTAND", "STAND", "DERSTAND",
]) console.log("  ", JSON.stringify(needle), "->", latin.includes(needle))
// dump contexts of 'UNDERSTAND'
let i = latin.indexOf("UNDERSTAND"), n = 0
while (i !== -1 && n < 3) {
  console.log("ctx @" + i + ":", JSON.stringify(latin.slice(i - 60, i + 40)))
  n++; i = latin.indexOf("UNDERSTAND", i + 1)
}
