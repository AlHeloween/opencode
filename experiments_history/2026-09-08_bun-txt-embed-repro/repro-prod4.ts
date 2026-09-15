// FINAL-2 bisect: the prod-shape builds differ from green bisect by target:"bun"
// absence. Matrix: with/without target + with/without minify+splitting.
// Usage: bun repro-prod4.ts <a|b|c|d>
import path from "path"
import fs from "fs"

const pkg = "D:/zPython/opencode/packages/opencode"
const mode = process.argv[2] ?? "a"
const entry = path.join(pkg, "src", "entry-repro-rel.ts")
if (!fs.existsSync(entry)) {
  fs.writeFileSync(
    entry,
    `import PROMPT_REASONING from "./session/prompt/reasoning_prompt.txt"\nconsole.log(typeof PROMPT_REASONING, PROMPT_REASONING.length)\n`,
  )
}

const cfg: Record<string, unknown> = {
  conditions: ["import"],
  format: "esm",
  compile: { outfile: path.join(pkg, "dist", `repro-final-${mode}.exe`) },
  entrypoints: [entry],
  root: pkg,
}
if (mode === "a" || mode === "b") cfg.target = "bun"
if (mode === "a" || mode === "c") {
  cfg.minify = true
  cfg.splitting = true
}

await Bun.build(cfg as never)

const exe = path.join(pkg, "dist", `repro-final-${mode}.exe`)
const bin = fs.readFileSync(exe).toString("latin1")
console.log(
  mode.padEnd(3),
  "| target:", mode === "a" || mode === "b" ? "bun" : "-",
  "| min+split:", mode === "a" || mode === "c" ? "yes" : "-",
  "| WORKFLOW:", bin.includes("## 0. WORKFLOW"),
  "|", fs.statSync(exe).size, "bytes",
)
