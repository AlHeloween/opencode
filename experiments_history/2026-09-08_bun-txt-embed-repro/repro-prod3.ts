// FINAL bisect: tsconfig presence is the only remaining factor.
// Usage: bun repro-prod3.ts <withts|nots>
import path from "path"
import fs from "fs"

const pkg = "D:/zPython/opencode/packages/opencode"
const useTs = process.argv[2] !== "nots"
const tag = useTs ? "withts" : "nots"

const entry = path.join(pkg, "src", "entry-repro-rel.ts")
if (!fs.existsSync(entry)) {
  fs.writeFileSync(
    entry,
    `import PROMPT_REASONING from "./session/prompt/reasoning_prompt.txt"\nconsole.log(typeof PROMPT_REASONING, PROMPT_REASONING.length)\n`,
  )
}

await Bun.build({
  ...(useTs ? { tsconfig: path.join(pkg, "tsconfig.json") } : {}),
  conditions: ["import"],
  format: "esm",
  minify: true,
  splitting: true,
  compile: { outfile: path.join(pkg, "dist", `repro-${tag}.exe`) },
  entrypoints: [entry],
  root: pkg,
})

const exe = path.join(pkg, "dist", `repro-${tag}.exe`)
const bin = fs.readFileSync(exe).toString("latin1")
console.log(tag.padEnd(8), "| WORKFLOW:", bin.includes("## 0. WORKFLOW"), "| spine:", bin.includes("gated_workflow: G0"), "|", fs.statSync(exe).size, "bytes")
