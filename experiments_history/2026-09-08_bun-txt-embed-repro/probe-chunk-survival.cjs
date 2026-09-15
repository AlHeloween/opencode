// Does ANY of chunk-4y49vg17.js survive into the compiled exe?
const fs = require("fs")
const pkg = "D:/zPython/opencode/packages/opencode"
const chunk = fs.readFileSync(pkg + "/dist/bundle-check2/chunk-4y49vg17.js", "utf8")
console.log("chunk bytes:", chunk.length)
// take 3 unique fragments: near start, middle, end (skip kernel region)
const frags = []
for (const [label, pos] of [["head", 200], ["mid", Math.floor(chunk.length / 2)], ["tail", chunk.length - 250]]) {
  // grab an identifier-looking run (letters/digits/_/$ only, len>=24)
  const re = /[A-Za-z_$][A-Za-z0-9_$]{30,}/g
  re.lastIndex = pos
  const m = re.exec(chunk)
  if (m) frags.push([label, m[0]])
}
const exe = fs.readFileSync(pkg + "/dist/cc-s1m0.exe").toString("latin1")
for (const [label, frag] of frags) {
  console.log(label.padEnd(5), JSON.stringify(frag.slice(0, 40)), "-> in exe:", exe.includes(frag))
}
// and the kernel var name from the context: _H=
console.log("kernel var _H=` present:", exe.includes("_H=`"))
console.log("template backtick kernel head:", exe.includes("## 0. WORKFLOW"))
