// Scalability probe: does the 19-byte first-line rule break when the bundle
// grows (877 assets / splitting)? Build a fake bundle: 600 dummy modules +
// one txt import. Compare small vs large bundle inline behavior.
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"
const bundleDir = path.join(dir, "bundle")
fs.mkdirSync(bundleDir, { recursive: true })

// long-first-line txt (41B header like the fixed kernel)
fs.writeFileSync(path.join(bundleDir, "kernel.txt"), "## 0. WORKFLOW — gated execution protocol\n" + "line ".repeat(5000))
const marker = "## 0. WORKFLOW"

async function build(tag: string, moduleCount: number) {
  for (let i = 0; i < moduleCount; i++) fs.writeFileSync(path.join(bundleDir, `mod${i}.ts`), `export const m${i} = ${i}\n`)
  const entry = path.join(bundleDir, `entry_${tag}.ts`)
  const imports = Array.from({ length: moduleCount }, (_, i) => `import { m${i} } from "./mod${i}"`).join("\n")
  fs.writeFileSync(entry, `${imports}\nimport k from "./kernel.txt"\nconsole.log(m${moduleCount - 1}, typeof k, k.length)\n`)
  const out = path.join(dir, `bundle_${tag}.exe`)
  const r = await Bun.build({
    entrypoints: [entry], root: bundleDir, target: "bun", format: "esm",
    minify: true, splitting: true, conditions: ["import"],
    compile: { outfile: out },
  })
  const bin = fs.readFileSync(out).toString("latin1")
  const assets = (bin.match(/B:\/~BUN\/root\/[A-Za-z0-9_\-./]*\.txt/g) ?? []).length
  console.log(tag.padEnd(8), "| modules:", String(moduleCount).padStart(3), "| inlined:", bin.includes(marker), "| txt assets:", assets)
}

await build("s1", 1)
await build("s50", 50)
await build("s600", 600)
