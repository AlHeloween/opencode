// Line-level delta: my GREEN content.txt vs failing variants. Green content:
//   "KERNEL_MAP marker line for repro probe.\nSecond line padding to make the file non-trivial.\n"
// Failing 'c_nomd' differs ONLY in tokens... but wait — check if green STILL
// passes (sanity: no environment drift between runs), then toggle one line at
// a time toward the failing shape.
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"

async function probe(tag: string, content: string): Promise<boolean> {
  const txtPath = path.join(dir, `l_${tag}.txt`)
  fs.writeFileSync(txtPath, content)
  const entry = path.join(dir, `entry_l_${tag}.ts`)
  fs.writeFileSync(entry, `import t from "./l_${tag}.txt"\nconsole.log(typeof t)\n`)
  const out = path.join(dir, `probe_l_${tag}.exe`)
  await Bun.build({ entrypoints: [entry], root: dir, target: "bun", compile: { outfile: out } })
  const bin = fs.readFileSync(out).toString("latin1")
  const needle = content.slice(0, 20).replace(/["\\\n\r]/g, "")
  return bin.includes(needle)
}

const green = fs.readFileSync(path.join(dir, "content.txt"), "utf8")
const cases: [string, string][] = [
  ["green_replay", green],
  ["green_plus_gates", green + "gates:\n- G0: UNDERSTAND\n"],
  ["gates_plus_green", "gates:\n- G0: UNDERSTAND\n" + green],
]

for (const [tag, content] of cases) {
  const ok = await probe(tag, content)
  console.log(tag.padEnd(18), "-> inlined:", ok)
}
