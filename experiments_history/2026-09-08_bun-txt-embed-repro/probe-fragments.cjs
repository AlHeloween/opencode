// Fragment probe: find kernel words alone in the fresh exe.
const fs = require("fs")
const pkg = "D:/zPython/opencode/packages/opencode"
const bin = fs.readFileSync(pkg + "/dist/opencode-windows-x64/bin/opencode.exe").toString("latin1")
for (const n of ["UNDERSTAND", "CLEAN_STATE", "AUTHORITY_SEPARATION", "KERNEL_MAP", "WORKFLOW", "reasoning_kernel_next", "GATED_WORKFLOW", "Digital Intention", "gates:", "WAITING_APPROVAL"]) {
  let count = 0
  let idx = bin.indexOf(n)
  while (idx !== -1 && count < 5) { count++; idx = bin.indexOf(n, idx + 1) }
  console.log(n.padEnd(22), "->", count > 0 ? `hits=${count}${count >= 5 ? "+" : ""}` : "ABSENT")
}
