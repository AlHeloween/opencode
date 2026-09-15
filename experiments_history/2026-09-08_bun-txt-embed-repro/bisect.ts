// Bisect: which prod-build option breaks .txt inlining?
// Stages reproduce build.ts Bun.build options incrementally.
// Usage: bun experiments/2026-09-08_bun-txt-embed-repro/bisect.ts <stage>
//   1 = splitting:true   2 = +minify   3 = +conditions
// (files option in build.ts is for embedded web UI map — different shape, not txt-related)
import txt from "./content.txt"
const stage = process.argv[2] ?? "0"
const out = `repro-s${stage}.exe`
await Bun.build({
  entrypoints: ["./repro.ts"],
  target: "bun",
  format: "esm",
  ...(stage >= "1" ? { splitting: true } : {}),
  ...(stage >= "2" ? { minify: true } : {}),
  ...(stage >= "3" ? { conditions: ["import"] } : {}),
  compile: { outfile: out },
})
console.log(`stage ${stage}: built ${out}`)
console.log("  runtime typeof txt:", typeof txt, "| len:", typeof txt === "string" ? txt.length : "n/a")
console.log("  has KERNEL_MAP:", typeof txt === "string" && txt.includes("KERNEL_MAP"))
