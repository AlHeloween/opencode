// Which bundle chunks hold kernel vs tooltxt? And are they the same chunk?
const fs = require("fs")
const path = require("path")
const pkg = "D:/zPython/opencode/packages/opencode"
const dir = pkg + "/dist/bundle-check2"
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"))
let kernelChunk = null, toolChunk = null
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), "utf8")
  if (!kernelChunk && t.includes("G0: UNDERSTAND")) kernelChunk = { f, size: t.length }
  if (!toolChunk && t.includes("Use this tool when you need to ask")) toolChunk = { f, size: t.length }
}
console.log("kernel chunk:", kernelChunk)
console.log("tooltxt chunk:", toolChunk)
console.log("same chunk:", kernelChunk && toolChunk && kernelChunk.f === toolChunk.f)
