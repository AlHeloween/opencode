// Bisect prod-shape failure: factors = solid plugin / tsconfig / alias import.
// Factor switch via argv: bun repro-prod2.ts <plugin|noplugin> <alias|relative>
import path from "path"
import fs from "fs"

const pkg = "D:/zPython/opencode/packages/opencode"
const usePlugin = process.argv[2] !== "noplugin"
const useAlias = process.argv[3] !== "relative"
const tag = `${usePlugin ? "plugin" : "noplugin"}-${useAlias ? "alias" : "rel"}`

const plugins = []
if (usePlugin) {
  const { createSolidTransformPlugin } = await import("@opentui/solid/bun-plugin")
  plugins.push(createSolidTransformPlugin())
}

// entry generated per-factor: alias or relative txt import
const entry = path.join(pkg, "src", `entry-repro-${tag.replace("-", "_")}.ts`)
fs.writeFileSync(
  entry,
  useAlias
    ? `import PROMPT_REASONING from "@/session/prompt/reasoning_prompt.txt"\nconsole.log(typeof PROMPT_REASONING, PROMPT_REASONING.length)\n`
    : `import PROMPT_REASONING from "./session/prompt/reasoning_prompt.txt"\nconsole.log(typeof PROMPT_REASONING, PROMPT_REASONING.length)\n`,
)

await Bun.build({
  conditions: ["import"],
  ...(usePlugin ? { plugins } : {}),
  external: ["node-gyp"],
  format: "esm",
  minify: true,
  splitting: true,
  compile: { outfile: path.join(pkg, "dist", `repro-${tag}.exe`) },
  entrypoints: [entry],
  root: pkg,
})

const exe = path.join(pkg, "dist", `repro-${tag}.exe`)
const bin = fs.readFileSync(exe).toString("latin1")
console.log(tag.padEnd(20), "| WORKFLOW:", bin.includes("## 0. WORKFLOW"), "| spine:", bin.includes("gated_workflow: G0"), "|", fs.statSync(exe).size, "bytes")
