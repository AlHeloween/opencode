// Reproduce the exact prod build failure minimally: import reasoning_prompt.txt
// the SAME way transform.ts does (alias @/session/prompt/...) inside the real
// package dir, compile with the same options incl. solid plugin, then probe bytes.
// Usage: bun experiments/2026-09-08_bun-txt-embed-repro/repro-prod.ts  (cwd: packages/opencode)
import path from "path"
import fs from "fs"

const pkg = path.resolve(import.meta.dir, "../../packages/opencode")
process.chdir(pkg)

// dynamic import so tsconfig paths + plugins resolve exactly like the real build
const { createSolidTransformPlugin } = await import("@opentui/solid/bun-plugin")
const plugin = createSolidTransformPlugin()

await Bun.build({
  conditions: ["import"],
  tsconfig: "./tsconfig.json",
  plugins: [plugin],
  external: ["node-gyp"],
  format: "esm",
  minify: true,
  splitting: true,
  compile: { outfile: "dist/repro-prod.exe" },
  entrypoints: ["./src/entry-repro.ts"],
})

const exe = fs.existsSync("dist/repro-prod.exe") ? "dist/repro-prod.exe" : "dist/repro-prod"
const bin = fs.readFileSync(exe).toString("latin1")
console.log("exe:", exe, fs.statSync(exe).size, "bytes")
console.log("WORKFLOW header in bytes:", bin.includes("## 0. WORKFLOW"))
console.log("old KERNEL_MAP in bytes:", bin.includes("KERNEL_MAP"))
console.log("GATED_WORKFLOW in bytes:", bin.includes("GATED_WORKFLOW"))
console.log("gated_workflow spine in bytes:", bin.includes("gated_workflow: G0"))
