const fs = require("fs")
const pkg = "D:/zPython/opencode/packages/opencode"
const entry = fs.readFileSync(pkg + "/dist/bundle-check2/index-8ntc0jmj.js", "utf8")
const i = entry.indexOf("chunk-4y49vg17")
console.log("entry size:", entry.length)
console.log("context around first ref:")
console.log(JSON.stringify(entry.slice(Math.max(0, i - 120), i + 80)))
// all refs
let count = 0, idx = entry.indexOf("chunk-4y49vg17")
while (idx !== -1) { count++; idx = entry.indexOf("chunk-4y49vg17", idx + 1) }
console.log("total refs in entry:", count)
