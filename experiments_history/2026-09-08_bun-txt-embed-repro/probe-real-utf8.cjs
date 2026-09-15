// Where did the kernel string go? exe has 0 txt assets + u2014 present but no
// ASCII kernel fragments. Maybe the string is stored UTF-8 (raw em-dash bytes)
// rather than escaped — minifier may convert \u2014 escapes back to UTF-8 bytes.
const fs = require("fs")
const pkg = "D:/zPython/opencode/packages/opencode"
const buf = fs.readFileSync(pkg + "/dist/opencode-windows-x64/bin/opencode.exe")
// search UTF-8 bytes of em-dash (E2 80 94) followed by ' gated'
const utf8 = buf.toString("utf8")
console.log("utf8 em-dash + ' gated':", utf8.includes("\u2014 gated"))
console.log("utf8 '0. WORKFLOW':", utf8.includes("0. WORKFLOW"))
console.log("utf8 'gated_workflow: G0':", utf8.includes("gated_workflow: G0"))
console.log("utf8 'G0: UNDERSTAND':", utf8.includes("G0: UNDERSTAND"))
console.log("utf8 'OUT_OF_SCOPE: terminal':", utf8.includes("OUT_OF_SCOPE: terminal"))
console.log("utf8 'WORKFLOW — gated execution protocol':", utf8.includes("WORKFLOW \u2014 gated execution protocol"))
