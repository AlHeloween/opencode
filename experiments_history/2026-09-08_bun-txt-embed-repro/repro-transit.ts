// Sanity matrix: direct vs transit import, same cycle dir.
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro/cyc"

const inlineTextPlugin: BunPlugin = {
  name: "txt-as-js-string",
  setup(build) {
    build.onLoad({ filter: /\.txt$/ }, (args) => ({
      contents: `export default ${JSON.stringify(fs.readFileSync(args.path, "utf8"))};`,
      loader: "js",
    }))
  },
}

// direct: entry imports k.txt directly
fs.writeFileSync(path.join(dir, "entry_direct.ts"), `import k from "./k.txt"\nconsole.log(k.length)\n`)

// transit via JS file (not TS)
fs.writeFileSync(path.join(dir, "a_js.js"), `import k from "./k.txt"\nexport const K = k\n`)
fs.writeFileSync(path.join(dir, "entry_viajs.ts"), `import { K } from "./a_js"\nconsole.log(K.length)\n`)

// transit with re-export only
fs.writeFileSync(path.join(dir, "a_reexp.ts"), `export { default as K } from "./k.txt"\n`)
fs.writeFileSync(path.join(dir, "entry_reexp.ts"), `import { K } from "./a_reexp"\nconsole.log(K.length)\n`)

async function build(tag: string, entry: string) {
  await Bun.build({
    entrypoints: [path.join(dir, entry)], root: dir, target: "bun",
    plugins: [inlineTextPlugin], minify: true, splitting: true, format: "esm",
    compile: { outfile: path.join(dir, `x_${tag}.exe`) },
  })
  const bin = fs.readFileSync(path.join(dir, `x_${tag}.exe`)).toString("latin1")
  console.log(tag.padEnd(8), "| kernel:", bin.includes("G0: UNDERSTAND"))
}

await build("direct", "entry_direct.ts")
await build("viajs", "entry_viajs.ts")
await build("reexp", "entry_reexp.ts")
