// FIRST-LINE trigger isolation. Confirmed: leading "gates:" flips loader to
// file-asset; "## ..." also flips. Hypothesis: Bun's text-loader treats the
// txt as... something else when the first line looks like a specific syntax.
// Test exact first lines (rest = green filler):
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"
const rest = "Second line padding to make the file non-trivial.\n"

async function probe(tag: string, firstLine: string): Promise<boolean> {
  const txtPath = path.join(dir, `f_${tag}.txt`)
  const content = firstLine + "\n" + rest
  fs.writeFileSync(txtPath, content)
  const entry = path.join(dir, `entry_f_${tag}.ts`)
  fs.writeFileSync(entry, `import t from "./f_${tag}.txt"\nconsole.log(typeof t)\n`)
  const out = path.join(dir, `probe_f_${tag}.exe`)
  await Bun.build({ entrypoints: [entry], root: dir, target: "bun", compile: { outfile: out } })
  const bin = fs.readFileSync(out).toString("latin1")
  const needle = content.slice(0, 20).replace(/["\\\n\r]/g, "")
  return bin.includes(needle)
}

const cases: [string, string][] = [
  ["plain", "KERNEL_MAP marker line for repro probe."],
  ["md", "## 0. WORKFLOW"],
  ["gates", "gates:"],
  ["gatedwf", "gated_workflow: G0 -> G1"],
  ["yamlkey", "nodes:"],
  ["word", "WORKFLOW"],
  ["hash2", "## just a heading"],
  ["colon", "somekey:"],
]

for (const [tag, line] of cases) {
  const ok = await probe(tag, line)
  console.log(tag.padEnd(8), "-> inlined:", ok)
}
