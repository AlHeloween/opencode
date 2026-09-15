// Byte-level onset hunt: real[0..64] fails, my synthetic 90B passes.
// Ladder of small candidates to isolate the trigger:
//  a) real[0..64]                       (known fail)
//  b) "## 0. WORKFLOW\n" + filler       (markdown heading start?)
//  c) "WORKFLOW\n" + filler             (same without ##)
//  d) "## " + filler                    (just markdown)
//  e) real[0..64] with '## ' stripped   (same bytes minus markdown)
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"
const real = fs.readFileSync("D:/zPython/opencode/packages/opencode/src/session/prompt/reasoning_prompt.txt", "utf8")

async function probe(tag: string, content: string): Promise<boolean> {
  const txtPath = path.join(dir, `t_${tag}.txt`)
  fs.writeFileSync(txtPath, content)
  const entry = path.join(dir, `entry_t_${tag}.ts`)
  fs.writeFileSync(entry, `import t from "./t_${tag}.txt"\nconsole.log(typeof t)\n`)
  const out = path.join(dir, `probe_t_${tag}.exe`)
  await Bun.build({ entrypoints: [entry], root: dir, target: "bun", compile: { outfile: out } })
  const bin = fs.readFileSync(out).toString("latin1")
  const needle = content.slice(0, 20).replace(/["\\\n\r]/g, "")
  return bin.includes(needle)
}

const head64 = real.slice(0, 64)
const cases: [string, string][] = [
  ["a_real64", head64],
  ["b_mdhead", "## 0. WORKFLOW\ngates:\n- G0: UNDERSTAND\n- G1: GROUND\nfiller line\n"],
  ["c_nomd", "WORKFLOW\ngates:\n- G0: UNDERSTAND\n- G1: GROUND\nfiller line\n"],
  ["d_mdonly", "## filler heading\nsecond line\nthird line here\n"],
  ["e_stripmd", head64.replace(/^## /, "")],
]

for (const [tag, content] of cases) {
  const ok = await probe(tag, content)
  console.log(tag.padEnd(10), "-> inlined:", ok)
}
