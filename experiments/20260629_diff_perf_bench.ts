/**
 * Diff rdiff-WASM vs Pierre performance comparison.
 * Run: bun run experiments/20260629_diff_perf_bench.ts
 */
import { parseDiffFromFile } from "@pierre/diffs"

async function main() {
  const BASE = "D:/zPython/opencode/packages/wasm/core/pkg"
  const rdiff = require(BASE + "/rdiff/rdiff.js")
  console.log("rdiff WASM: loaded")

  function gen(n: number, base: string): string {
    const lines: string[] = []
    for (let i = 0; i < n; i++) lines.push(`${base} line ${i} with padding for realistic diff length testing`)
    return lines.join("\n")
  }

  function mod(t: string, pct: number): string {
    const lines = t.split("\n")
    const r = [...lines]
    const mc = Math.floor(lines.length * pct)
    for (let i = 0; i < mc; i++) {
      const idx = Math.floor(Math.random() * lines.length)
      r[idx] = `MODIFIED ${idx} extra padding for realistic diff length benchmark`
    }
    return r.join("\n")
  }

  const cases: [string, string, string][] = [
    ["50 ident", gen(50, "m"), gen(50, "m")],
    ["50 20% mod", gen(50, "m"), mod(gen(50, "m"), 0.2)],
    ["200 ident", gen(200, "l"), gen(200, "l")],
    ["200 10% mod", gen(200, "l"), mod(gen(200, "l"), 0.1)],
    ["500 ident", gen(500, "xl"), gen(500, "xl")],
    ["500 5% mod", gen(500, "xl"), mod(gen(500, "xl"), 0.05)],
    ["1000 ident", gen(1000, "xxl"), gen(1000, "xxl")],
    ["2000 2% mod", gen(2000, "huge"), mod(gen(2000, "huge"), 0.02)],
    ["5000 1% mod", gen(5000, "giant"), mod(gen(5000, "giant"), 0.01)],
  ]

  const ITER = 50

  console.log(`\nBenchmark (${ITER} iterations, warm=1, ms)`)
  console.log("| Case | Pierre | rdiff WASM | rdiff/Pierre | Note |")
  console.log("|------|--------|------------|--------------|------|")

  for (const [name, oldText, newText] of cases) {
    // Warm
    parseDiffFromFile({ name: "o", contents: oldText }, { name: "n", contents: newText })
    try { rdiff.diff_compute(oldText, newText) } catch {}

    // Pierre
    const pt: number[] = []
    for (let i = 0; i < ITER; i++) {
      const t0 = performance.now()
      parseDiffFromFile({ name: "o", contents: oldText }, { name: "n", contents: newText })
      pt.push(performance.now() - t0)
    }

    // rdiff
    const rt: number[] = []
    let rdOk = true
    for (let i = 0; i < ITER; i++) {
      try {
        const t0 = performance.now()
        const result = rdiff.diff_compute(oldText, newText)
        rt.push(performance.now() - t0)
        // Verify result parses
        if (result && result !== "[]") JSON.parse(result)
      } catch {
        rdOk = false
        break
      }
    }

    const pavg = pt.reduce((a,b)=>a+b)/ITER
    const ravg = rdOk ? rt.reduce((a,b)=>a+b)/ITER : 0
    const ratio = pavg > 0 ? ravg / pavg : 0
    const faster = ratio < 0.8 ? "!" : ratio > 1.2 ? "?" : ""

    const rStr = rdOk ? ravg.toFixed(3) : "CRASH"
    const ratioStr = rdOk ? ratio.toFixed(2) + "x" : "-"

    console.log(`| ${name} | ${pavg.toFixed(3)} | ${rStr} | ${ratioStr} | ${faster} |`)
  }
}

main().catch(e => console.error(e))
