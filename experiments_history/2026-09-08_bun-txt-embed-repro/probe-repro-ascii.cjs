// repro-prod.ts checks raw UTF-8 needle — but js-loader inlines ESCAPED
// (\u2014). Fix the probe: check ASCII-only tail of the kernel text instead.
const path = require("path")
const fs = require("fs")
const pkg = "D:/zPython/opencode/packages/opencode"
const bin = fs.readFileSync(path.join(pkg, "dist/repro-prod.exe")).toString("latin1")
console.log("exe:", fs.statSync(path.join(pkg, "dist/repro-prod.exe")).size, "bytes")
// ASCII-only fragments of the kernel text (no em-dashes/arrows):
console.log("gates: G0: UNDERSTAND :", bin.includes("G0: UNDERSTAND"))
console.log("gated_workflow spine (ASCII 'gated_workflow: G0'):", bin.includes("gated_workflow: G0"))
console.log("0. WORKFLOW (ASCII):", bin.includes("0. WORKFLOW"))
console.log("WORKFLOW heading escaped u2014:", bin.includes("u2014"))
const real = fs.readFileSync(path.join(pkg, "src/session/prompt/reasoning_prompt.txt"), "utf8")
const asciiSample = real.split("\n").find((l) => l.length > 20 && !/[^\x00-\x7F]/.test(l))
console.log("ASCII sample line:", JSON.stringify(asciiSample), "->", asciiSample ? bin.includes(asciiSample) : "n/a")
