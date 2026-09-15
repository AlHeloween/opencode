// Confirm hypothesis shape: is it plain LENGTH or content-class? Two probes:
//  a) 18x 'K' + newline -> FAIL expected (len 18)
//  b) 18x 'K' with NO newline before rest (single long line) -> same len 18+rest... 
//     distinguishes first-LINE vs first-TOKEN
//  c) shebang '#!/x' first line (classic bun hashbang case) -> expect FAIL
//  d) 18 chars with a space ('K K K ...') -> does tokenization matter
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"
const rest = "Second line padding to make the file non-trivial.\n"

async function probe(tag: string, content: string): Promise<boolean> {
  const txtPath = path.join(dir, `c_${tag}.txt`)
  fs.writeFileSync(txtPath, content)
  const entry = path.join(dir, `entry_c_${tag}.ts`)
  fs.writeFileSync(entry, `import t from "./c_${tag}.txt"\nconsole.log(typeof t)\n`)
  const out = path.join(dir, `probe_c_${tag}.exe`)
  await Bun.build({ entrypoints: [entry], root: dir, target: "bun", compile: { outfile: out } })
  const bin = fs.readFileSync(out).toString("latin1")
  const needle = content.slice(0, 20).replace(/["\\\n\r]/g, "")
  return bin.includes(needle)
}

const cases: [string, string][] = [
  ["a_18nl", "K".repeat(18) + "\n" + rest],
  ["b_18nonl", "K".repeat(18) + rest],
  ["c_shebang", "#!/usr/bin/env test\n" + rest],
  ["d_18spaces", ("K ").repeat(9) + "\n" + rest],
]

for (const [tag, content] of cases) {
  const ok = await probe(tag, content)
  console.log(tag.padEnd(10), "-> inlined:", ok)
}
