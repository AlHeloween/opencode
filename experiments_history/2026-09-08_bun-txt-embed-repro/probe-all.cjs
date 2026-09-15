// Probe ALL stage binaries: which option flips .txt from inline-text to file-asset?
const fs = require("fs")
const path = require("path")
const dir = __dirname
for (const stage of ["s0", "s1", "s2", "s3"]) {
  const exe = path.join(dir, `repro-${stage}.exe`)
  if (!fs.existsSync(exe)) { console.log(stage, ": missing"); continue }
  const text = fs.readFileSync(exe).toString("latin1")
  const assets = text.match(/B:\/~BUN\/root\/[A-Za-z0-9_\-./]*content[A-Za-z0-9_\-./]*\.txt/g) ?? []
  console.log(
    stage,
    "| KERNEL_MAP bytes:", text.includes("KERNEL_MAP"),
    "| marker:", text.includes("marker line for repro probe"),
    "| asset names:", assets.length > 0 ? assets[0].split("/").pop() : "(none)",
  )
}
