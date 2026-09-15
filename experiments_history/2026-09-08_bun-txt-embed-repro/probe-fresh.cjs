// Probe the FRESH (failed-smoke) exe: is reasoning_prompt still an asset?
// Compare with old probe: 56 txt assets? Is the header present? Any
// 'gated execution protocol' bytes anywhere?
const fs = require("fs")
const buf = fs.readFileSync("D:/zPython/opencode/packages/opencode/dist/opencode-windows-x64/bin/opencode.exe")
const text = buf.toString("latin1")
console.log("exe size:", buf.length)
console.log("'## 0. WORKFLOW' in bytes:", text.includes("## 0. WORKFLOW"))
console.log("'gated execution protocol' in bytes:", text.includes("gated execution protocol"))
console.log("'gated_workflow: G0' in bytes:", text.includes("gated_workflow: G0"))
const names = new Set()
const re = /B:\/~BUN\/root\/([A-Za-z0-9_\-./]+?)(?=\x00)/g
let m
while ((m = re.exec(text)) !== null) names.add(m[1])
const txt = [...names].filter((n) => n.endsWith(".txt"))
console.log("total assets:", names.size, "| txt assets:", txt.length)
console.log("reasoning asset:", txt.filter((n) => n.includes("reasoning")))
console.log("kernel text first bytes in exe:", text.includes("0. WORKFLOW"))
