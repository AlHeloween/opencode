// Cross-test: same relative import '../src/session/prompt/reasoning_prompt.txt'
// built from two cwds (pkg script/ vs experiments/). A/B decides cwd-vs-import.
import path from "path"
const pkg = "D:/zPython/opencode/packages/opencode"

async function build(tag: string, entryAbs: string, rootAbs: string) {
  const out = path.join(pkg, "dist", `repro-sib-${tag}.exe`)
  const r = await Bun.build({ entrypoints: [entryAbs], root: rootAbs, target: "bun", compile: { outfile: out } })
  const bin = require("fs").readFileSync(out).toString("latin1")
  console.log(tag.padEnd(10), "| success:", r.success, "| WORKFLOW:", bin.includes("## 0. WORKFLOW"), "| spine:", bin.includes("gated_workflow: G0"))
}

// A: entry in pkg/script, root = pkg/script (same as green experiments case)
await build("script", path.join(pkg, "script/entry-sib.ts"), path.join(pkg, "script"))
// B: entry in experiments, root = experiments (proven green case shape)
await build("experiments", "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro/entry-sib2.ts", "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro")
