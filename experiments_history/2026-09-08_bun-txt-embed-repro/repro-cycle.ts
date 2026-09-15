// Minimal cycle repro: entry -> A -> (cycle back to entry) with txt import in
// A. Does compile drop A's string? vs non-cycle control.
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro/cyc"
fs.mkdirSync(dir, { recursive: true })
const txt = "## 0. WORKFLOW — gated execution protocol\n" + "line ".repeat(5000)
fs.writeFileSync(path.join(dir, "k.txt"), txt)

const inlineTextPlugin: BunPlugin = {
  name: "txt-as-js-string",
  setup(build) {
    build.onLoad({ filter: /\.txt$/ }, (args) => ({
      contents: `export default ${JSON.stringify(fs.readFileSync(args.path, "utf8"))};`,
      loader: "js",
    }))
  },
}

// control: entry -> A -> txt (no cycle)
fs.writeFileSync(path.join(dir, "a_ctrl.ts"), `import k from "./k.txt"\nexport const K = k\n`)
fs.writeFileSync(path.join(dir, "entry_ctrl.ts"), `import { K } from "./a_ctrl"\nconsole.log(K.length)\n`)

// cycle: entry -> A -> entry (cycle), txt in A
fs.writeFileSync(path.join(dir, "a_cyc.ts"), `import k from "./k.txt"\nimport { marker } from "./entry_cyc"\nexport const K = k + marker\n`)
fs.writeFileSync(path.join(dir, "entry_cyc.ts"), `import { K } from "./a_cyc"\nexport const marker = "M"\nconsole.log(K.length)\n`)

async function build(tag: string, entry: string) {
  await Bun.build({
    entrypoints: [path.join(dir, entry)], root: dir, target: "bun",
    plugins: [inlineTextPlugin], minify: true, splitting: true, format: "esm",
    compile: { outfile: path.join(dir, `out_${tag}.exe`) },
  })
  const bin = fs.readFileSync(path.join(dir, `out_${tag}.exe`)).toString("latin1")
  console.log(tag.padEnd(8), "| kernel in exe:", bin.includes("G0: UNDERSTAND"), "|", fs.statSync(path.join(dir, `out_${tag}.exe`)).size)
}

await build("ctrl", "entry_ctrl.ts")
await build("cyc", "entry_cyc.ts")
