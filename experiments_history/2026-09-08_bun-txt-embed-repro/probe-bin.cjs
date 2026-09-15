// Probe the compiled repro binary: is content.txt content inlined as text
// (KERNEL_MAP marker present in bytes) or stored as a BunFS file asset?
const fs = require("fs")
const path = require("path")
const dir = __dirname
const exe = fs.existsSync(path.join(dir, "repro.exe")) ? path.join(dir, "repro.exe") : null
if (!exe) {
  console.log("no repro.exe found")
  process.exit(0)
}
const buf = fs.readFileSync(exe)
const text = buf.toString("latin1")
console.log("exe size:", buf.length)
console.log("KERNEL_MAP in bytes:", text.includes("KERNEL_MAP"))
console.log("marker line in bytes:", text.includes("marker line for repro probe"))
const m = text.match(/B:\/~BUN\/root\/[A-Za-z0-9_\-./]*content[A-Za-z0-9_\-./]*\.txt/g)
console.log("BunFS content asset names:", m)
