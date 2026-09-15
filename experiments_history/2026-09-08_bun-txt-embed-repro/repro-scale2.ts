// Scale threshold: em-dash txt at 0.5MB / 1MB / 1.5MB / 2MB — which drops?
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro/esc"

const inlineTextPlugin: BunPlugin = {
  name: "txt-as-js-string",
  setup(build) {
    build.onLoad({ filter: /\.txt$/ }, (args) => ({
      contents: `export default ${JSON.stringify(fs.readFileSync(args.path, "utf8"))};`,
      loader: "js",
    }))
  },
}

const entryImports: string[] = []
const consoleArgs: string[] = []
const sizes = [0.5, 1, 1.5, 2]
for (const mb of sizes) {
  const bytes = Math.floor(mb * 1024 * 1024)
  const name = `big_${String(mb).replace(".", "_")}`
  fs.writeFileSync(
    path.join(dir, `${name}.txt`),
    "## 0. WORKFLOW — gated execution protocol\n" + `G0U${mb} `.repeat(Math.ceil(bytes / 7)),
  )
  fs.writeFileSync(path.join(dir, `mod_${name}.ts`), `import k from "./${name}.txt"\nexport const K_${name.replace(".", "_")} = k\n`)
  entryImports.push(`import { K_${name.replace(".", "_")} } from "./mod_${name}"`)
  consoleArgs.push(`K_${name.replace(".", "_")}.length`)
}
fs.writeFileSync(path.join(dir, "entry_big.ts"), entryImports.join("\n") + "\nconsole.log(" + consoleArgs.join(", ") + ")\n")

await Bun.build({
  entrypoints: [path.join(dir, "entry_big.ts")], root: dir, target: "bun",
  plugins: [inlineTextPlugin], minify: true, splitting: true, format: "esm",
  compile: { outfile: path.join(dir, "big_test.exe") },
})

const bin = fs.readFileSync(path.join(dir, "big_test.exe")).toString("latin1")
for (const mb of sizes) {
  const tag = `G0U${mb} `
  console.log(`${mb}MB ->`, bin.includes(tag) ? "PRESENT" : "DROPPED")
}
console.log("exe size:", fs.statSync(path.join(dir, "big_test.exe")).size)
