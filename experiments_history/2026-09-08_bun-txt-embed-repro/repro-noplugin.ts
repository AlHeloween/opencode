// DECISIVE: compiled exe WITHOUT plugin — does the runtime see txt CONTENT
// (bun lazy-reads the asset) or a PATH STUB (string len ~40)?
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro/noplugin"
fs.mkdirSync(dir, { recursive: true })
fs.copyFileSync("D:/zPython/opencode/packages/opencode/src/session/prompt/reasoning_prompt.txt", path.join(dir, "real.txt"))
fs.writeFileSync(path.join(dir, "entry.ts"), `import t from "./real.txt"\nconsole.log("LEN:", t.length)\nconsole.log("HEAD:", t.slice(0, 20))\n`)

await Bun.build({
  entrypoints: [path.join(dir, "entry.ts")], root: dir, target: "bun",
  minify: true, splitting: true, format: "esm",
  compile: { outfile: path.join(dir, "noplugin.exe") },
})

const bin = fs.readFileSync(path.join(dir, "noplugin.exe")).toString("latin1")
console.log("bytes contain G0: UNDERSTAND:", bin.includes("G0: UNDERSTAND"))
console.log("asset stub present:", /B:\/~BUN\/root\/real[A-Za-z0-9_\-]*\.txt/.test(bin))
