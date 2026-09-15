// LENGTH hypothesis: 'gatedwf' (25 chars) passed; 'gates:' (6) failed. Sweep
// first-line lengths with identical filler: find the exact char threshold.
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"
const rest = "Second line padding to make the file non-trivial.\n"

async function probe(tag: string, firstLine: string): Promise<boolean> {
  const txtPath = path.join(dir, `len_${tag}.txt`)
  const content = firstLine + "\n" + rest
  fs.writeFileSync(txtPath, content)
  const entry = path.join(dir, `entry_len_${tag}.ts`)
  fs.writeFileSync(entry, `import t from "./len_${tag}.txt"\nconsole.log(typeof t)\n`)
  const out = path.join(dir, `probe_len_${tag}.exe`)
  await Bun.build({ entrypoints: [entry], root: dir, target: "bun", compile: { outfile: out } })
  const bin = fs.readFileSync(out).toString("latin1")
  const needle = content.slice(0, 20).replace(/["\\\n\r]/g, "")
  return bin.includes(needle)
}

// sweep: first-line length 8..40 chars ('A' repeated + counter suffix for uniqueness)
for (const n of [8, 10, 12, 14, 15, 16, 17, 18, 19, 20, 22, 24, 25, 26, 28, 32, 40]) {
  const line = "K".repeat(n) + String(n)
  const ok = await probe(`n${n}`, line)
  console.log("len", String(line.length).padStart(2), "-> inlined:", ok)
  if (n >= 20 && ok) break // found crossing
}
