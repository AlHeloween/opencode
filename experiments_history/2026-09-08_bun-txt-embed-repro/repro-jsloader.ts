// Fix-candidate 2: onLoad with loader:"js" and JSON.stringify(contents) —
// import becomes a real JS string literal; asset sniffer must be bypassed.
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"
const content = "## 0. WORKFLOW — gated execution protocol\n" + "line ".repeat(5000)
fs.writeFileSync(path.join(dir, "jsl_txt.txt"), content)

const plugin: BunPlugin = {
  name: "txt-as-js-string",
  setup(build) {
    build.onLoad({ filter: /\.txt$/ }, (args) => ({
      contents: `export default ${JSON.stringify(fs.readFileSync(args.path, "utf8"))};`,
      loader: "js",
    }))
  },
}

const entry = path.join(dir, "entry_jsl.ts")
fs.writeFileSync(entry, `import t from "./jsl_txt.txt"\nconsole.log(typeof t, t.length, t.slice(0, 14))\n`)

const out = path.join(dir, "probe_jsl.exe")
await Bun.build({ entrypoints: [entry], root: dir, target: "bun", compile: { outfile: out }, plugins: [plugin] })
const bin = fs.readFileSync(out).toString("latin1")
const needle = content.slice(0, 20).replace(/["\\\n\r]/g, "")
console.log("js-string-loader -> inlined:", bin.includes(needle))
