// Decisive: probe_jsl config vs cyc config, direct import, one diff at a time.
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

// k.txt must be in the SAME root as the entry (probe_jsl root=dir of entry)
const txt = "## 0. WORKFLOW — gated execution protocol\n" + "line ".repeat(5000)
fs.writeFileSync(path.join(dir, "k.txt"), txt)

async function build(tag: string, extra: Record<string, unknown>) {
  await Bun.build({
    entrypoints: [path.join(dir, "entry_direct.ts")], root: dir, target: "bun",
    plugins: [inlineTextPlugin],
    compile: { outfile: path.join(dir, `d_${tag}.exe`) },
    ...extra,
  })
  const bin = fs.readFileSync(path.join(dir, `d_${tag}.exe`)).toString("latin1")
  console.log(tag.padEnd(10), "| kernel:", bin.includes("G0: UNDERSTAND"))
}

// a) exact probe_jsl shape (baseline, expect PASS)
await build("baseline", {})
// b) + splitting/minify
await build("splitmin", { splitting: true, minify: true, format: "esm" })
// c) + explicit windows target
await build("wintarget", { compile: { outfile: path.join(dir, "d_wintarget.exe"), target: "bun-windows-x64" as never, windows: {} } })
// d) + execArgv
await build("execargv", { compile: { outfile: path.join(dir, "d_execargv.exe"), execArgv: ["--user-agent=opencode/test", "--use-system-ca", "--"] } })
