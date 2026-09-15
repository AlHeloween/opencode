// ISOLATION: earlier 25.6KB sweep files were 'SIZEMARK_<n>_KERNEL_MAP\n' + 'x' fill
// → PASSED. Kernel-shape file '## 0. WORKFLOW — gated execution protocol\n' + lines
// → FAILS even with 41B first line. Diff candidates: '##' prefix, em-dash (—,
// non-ASCII!), multi-line filler vs single-token filler.
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"
const big = "line ".repeat(5000) // ~25KB filler

async function probe(tag: string, content: string): Promise<boolean> {
  const txtPath = path.join(dir, `iso_${tag}.txt`)
  fs.writeFileSync(txtPath, content)
  const entry = path.join(dir, `entry_iso_${tag}.ts`)
  fs.writeFileSync(entry, `import t from "./iso_${tag}.txt"\nconsole.log(typeof t, t.length)\n`)
  const out = path.join(dir, `probe_iso_${tag}.exe`)
  await Bun.build({ entrypoints: [entry], root: dir, target: "bun", compile: { outfile: out } })
  const bin = fs.readFileSync(out).toString("latin1")
  const needle = content.slice(0, 20).replace(/["\\\n\r]/g, "")
  return bin.includes(needle)
}

const cases: [string, string][] = [
  ["a_plain_long", "SIZEMARK_AAAAAAAAAAAAAAAAAA_KERNEL_MAP\n" + big],
  ["b_md_long", "## 0. WORKFLOW — gated execution protocol\n" + big],
  ["c_md_ascii", "## 0. WORKFLOW - gated execution protocol\n" + big], // no em-dash
  ["d_nodash", "WORKFLOW gated execution protocol long header line\n" + big],
  ["e_emdash_only", "WORKFLOW — gated execution protocol long header\n" + big],
]

for (const [tag, content] of cases) {
  const ok = await probe(tag, content)
  console.log(tag.padEnd(14), "-> inlined:", ok)
}
