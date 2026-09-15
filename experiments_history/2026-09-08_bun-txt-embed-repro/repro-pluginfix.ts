// Fix-candidate test: custom Bun plugin with onLoad returning contents +
// loader:"text". Does it override the asset sniffer for non-ASCII txt?
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"
const content = "## 0. WORKFLOW — gated execution protocol\n" + "line ".repeat(5000)
fs.writeFileSync(path.join(dir, "plugin_txt.txt"), content)

const plugin: BunPlugin = {
  name: "force-text",
  setup(build) {
    build.onLoad({ filter: /\.txt$/ }, (args) => ({ contents: fs.readFileSync(args.path, "utf8"), loader: "text" }))
  },
}

const entry = path.join(dir, "entry_plugin.ts")
fs.writeFileSync(entry, `import t from "./plugin_txt.txt"\nconsole.log(typeof t, t.length)\n`)

const out = path.join(dir, "probe_plugin.exe")
await Bun.build({ entrypoints: [entry], root: dir, target: "bun", compile: { outfile: out }, plugins: [plugin] })
const bin = fs.readFileSync(out).toString("latin1")
const needle = content.slice(0, 20).replace(/["\\\n\r]/g, "")
console.log("plugin-forced-text -> inlined:", bin.includes(needle))
