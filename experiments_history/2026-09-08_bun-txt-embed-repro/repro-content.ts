// CONTENT bisect: the real reasoning_prompt.txt never inlines while synthetic
// files (any size) do. Import the real file from experiments dir, then bisect
// by content: full file vs first half vs second half. Decides if a specific
// byte sequence switches Bun's loader.
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"
const real = fs.readFileSync("D:/zPython/opencode/packages/opencode/src/session/prompt/reasoning_prompt.txt", "utf8")
console.log("real file bytes:", real.length)

const variants: [string, string][] = [
  ["real_full", real],
  ["real_half1", real.slice(0, Math.floor(real.length / 2))],
  ["real_half2", real.slice(Math.floor(real.length / 2))],
  ["real_head4k", real.slice(0, 4096)],
]

for (const [tag, content] of variants) {
  const txtPath = path.join(dir, `content_${tag}.txt`)
  fs.writeFileSync(txtPath, content)
  const entry = path.join(dir, `entry_${tag}.ts`)
  fs.writeFileSync(entry, `import t from "./content_${tag}.txt"\nconsole.log(typeof t)\n`)
  const out = path.join(dir, `probe_${tag}.exe`)
  const r = await Bun.build({ entrypoints: [entry], root: dir, target: "bun", compile: { outfile: out } })
  const bin = fs.readFileSync(out).toString("latin1")
  const needle = content.slice(0, 40).replace(/["\\\n\r]/g, "").slice(0, 24)
  console.log(tag.padEnd(12), "| build:", r.success, "| head-bytes-inlined:", bin.includes(needle))
}
