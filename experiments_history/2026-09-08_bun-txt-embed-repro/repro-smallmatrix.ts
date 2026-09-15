// Small-bundle matrix: entry -> a_ctrl -> k.txt with {splitting,minify} on/off.
// Isolate which flag breaks the js-string constant through an intermediate module.
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

for (const [splitting, minify] of [[false, false], [true, false], [false, true], [true, true]] as const) {
  const tag = `s${Number(splitting)}m${Number(minify)}`
  await Bun.build({
    entrypoints: [path.join(dir, "entry_ctrl.ts")], root: dir, target: "bun",
    plugins: [inlineTextPlugin], minify, splitting, format: "esm",
    compile: { outfile: path.join(dir, `m_${tag}.exe`) },
  })
  const bin = fs.readFileSync(path.join(dir, `m_${tag}.exe`)).toString("latin1")
  console.log(tag, "| kernel:", bin.includes("G0: UNDERSTAND"), "|", fs.statSync(path.join(dir, `m_${tag}.exe`)).size)
}
