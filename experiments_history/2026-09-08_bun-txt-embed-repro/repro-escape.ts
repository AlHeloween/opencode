// Isolate the EM-DASH escape as the compile-drop trigger:
// two txts, identical except one char: ASCII '-' vs '—'. Compile both paths.
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro/esc"
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, "ascii.txt"), "## 0. WORKFLOW - gated execution protocol\n" + "G0: UNDERSTAND line " .repeat(1000))
fs.writeFileSync(path.join(dir, "emdash.txt"), "## 0. WORKFLOW — gated execution protocol\n" + "G0: UNDERSTAND line ".repeat(1000))
fs.writeFileSync(path.join(dir, "a_ascii.ts"), `import k from "./ascii.txt"\nexport const K = k\n`)
fs.writeFileSync(path.join(dir, "b_emdash.ts"), `import k from "./emdash.txt"\nexport const K = k\n`)
fs.writeFileSync(path.join(dir, "entry.ts"), `import { K as A } from "./a_ascii"\nimport { K as B } from "./b_emdash"\nconsole.log(A.length, B.length)\n`)

const inlineTextPlugin: BunPlugin = {
  name: "txt-as-js-string",
  setup(build) {
    build.onLoad({ filter: /\.txt$/ }, (args) => ({
      contents: `export default ${JSON.stringify(fs.readFileSync(args.path, "utf8"))};`,
      loader: "js",
    }))
  },
}

await Bun.build({
  entrypoints: [path.join(dir, "entry.ts")], root: dir, target: "bun",
  plugins: [inlineTextPlugin], minify: true, splitting: true, format: "esm",
  compile: { outfile: path.join(dir, "esc_test.exe") },
})

const bin = fs.readFileSync(path.join(dir, "esc_test.exe")).toString("latin1")
console.log("ASCII txt in exe:", bin.includes("WORKFLOW - gated execution protocol"))
console.log("em-dash txt in exe:", bin.includes("WORKFLOW \\u2014 gated execution protocol"))
console.log("needle G0: UNDERSTAND:", bin.includes("G0: UNDERSTAND"))
