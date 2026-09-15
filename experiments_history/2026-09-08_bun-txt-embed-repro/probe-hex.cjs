// Find the actual byte layout of a minified big template string: dump hex
// around a 'STAND' hit in cc-s0m0.exe to see how 'UNDERSTAND' got split.
const fs = require("fs")
const pkg = "D:/zPython/opencode/packages/opencode"
const buf = fs.readFileSync(pkg + "/dist/cc-s0m0.exe")
const latin = buf.toString("latin1")
const i = latin.indexOf("STAND")
console.log("first STAND @" + i)
console.log(JSON.stringify(buf.subarray(i - 80, i + 80).toString("latin1")))
console.log("hex:", buf.subarray(i - 16, i + 24).toString("hex").match(/.{2}/g).join(" "))
