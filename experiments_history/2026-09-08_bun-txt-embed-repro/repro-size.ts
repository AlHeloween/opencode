// SIZE THRESHOLD test: generate txt of increasing size, import, compile, probe.
// Hypothesis: Bun switches txt import to file-asset above a byte threshold
// (tiny 90B inlines; 25.6KB reasoning_prompt does not). Find the boundary.
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"
const sizes = [1024, 4096, 8192, 16384, 20000, 24576, 25000, 25600, 32768]

for (const size of sizes) {
  const marker = `SIZEMARK_${size}_KERNEL_MAP`
  const txtPath = path.join(dir, `size_${size}.txt`)
  // pad with repeated lines to exact byte size, marker at the very start
  const filler = "x".repeat(Math.max(0, size - marker.length - 1))
  fs.writeFileSync(txtPath, marker + "\n" + filler)

  const entry = path.join(dir, `entry_size.ts`)
  fs.writeFileSync(entry, `import t from "./size_${size}.txt"\nconsole.log(typeof t)\n`)

  const out = path.join(dir, `size_${size}.exe`)
  const r = await Bun.build({ entrypoints: [entry], root: dir, target: "bun", compile: { outfile: out } })
  const bin = fs.readFileSync(out).toString("latin1")
  console.log(String(size).padStart(6), "| build:", r.success, "| inlined:", bin.includes(marker))
}
