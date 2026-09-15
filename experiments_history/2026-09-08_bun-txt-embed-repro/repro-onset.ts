// CONVERGENCE bisect: synthetic green (my content.txt) vs real red.
// Build a ladder: real file with synthetic's FIRST LINE swapped in, growing
// prefix. Instead simpler: binary search on the real file itself — probe
// which PREFIX length starts failing. 90B synthetic passes; find failure onset.
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"
const real = fs.readFileSync("D:/zPython/opencode/packages/opencode/src/session/prompt/reasoning_prompt.txt", "utf8")

async function probe(tag: string, content: string): Promise<boolean> {
  const txtPath = path.join(dir, `bis_${tag}.txt`)
  fs.writeFileSync(txtPath, content)
  const entry = path.join(dir, `entry_bis_${tag}.ts`)
  fs.writeFileSync(entry, `import t from "./bis_${tag}.txt"\nconsole.log(typeof t)\n`)
  const out = path.join(dir, `probe_bis_${tag}.exe`)
  await Bun.build({ entrypoints: [entry], root: dir, target: "bun", compile: { outfile: out } })
  const bin = fs.readFileSync(out).toString("latin1")
  const needle = content.slice(0, 24).replace(/["\\\n\r]/g, "")
  return bin.includes(needle)
}

// exponential probe: 64B, 128, 256, 512, 1K, 2K, 4K of the real file
for (const size of [64, 128, 256, 512, 1024, 2048, 4096]) {
  const ok = await probe(`p${size}`, real.slice(0, size))
  console.log(String(size).padStart(5), "B -> inlined:", ok)
  if (!ok) break
}
