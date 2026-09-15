// Probe REAL fresh exe (built with inline plugin): ASCII needles only.
const fs = require("fs")
const pkg = "D:/zPython/opencode/packages/opencode"
const bin = fs.readFileSync(pkg + "/dist/opencode-windows-x64/bin/opencode.exe").toString("latin1")
console.log("exe size:", fs.statSync(pkg + "/dist/opencode-windows-x64/bin/opencode.exe").size)
console.log("ASCII 'G0: UNDERSTAND':", bin.includes("G0: UNDERSTAND"))
console.log("ASCII 'gated_workflow: G0':", bin.includes("gated_workflow: G0"))
console.log("ASCII '0. WORKFLOW':", bin.includes("0. WORKFLOW"))
console.log("escaped em-dash u2014:", bin.includes("u2014"))
console.log("ASCII '- OUT_OF_SCOPE: terminal':", bin.includes("- OUT_OF_SCOPE: terminal"))
const names = new Set()
const re = /B:\/~BUN\/root\/([A-Za-z0-9_\-./]+?)(?=\x00)/g
let m
while ((m = re.exec(bin)) !== null) names.add(m[1])
const txt = [...names].filter((n) => n.endsWith(".txt"))
console.log("txt assets:", txt.length, "| reasoning:", txt.filter((n) => n.includes("reasoning")))
