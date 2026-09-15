// Probe: measure the cost of Log.init's cleanup() step for various log-file counts.
// Reproduces the mechanics of packages/core/src/util/log.ts cleanup():
//   readdir(dir, withFileTypes) -> filter by name pattern -> sort -> unlink all but `keep`
const fs = require("fs/promises")
const path = require("path")
const os = require("os")

const PATTERN = /^\d{13}_(log|diff|payload)_.+\.(jsonl|diff|json|md)$/
const keep = 100

function matchable(name) {
  return PATTERN.test(name)
}

;(async () => {
  for (const N of [50, 150, 300, 800, 2000]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cg-"))
    const names = []
    for (let i = 0; i < N; i++) {
      const n = String(1700000000000 + i) + "_log_system_internal.jsonl"
      await fs.writeFile(path.join(dir, n), '{"x":1}')
      names.push(n)
    }

    // ---- replicate cleanup() ----
    const t0 = performance.now()
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const files = entries
      .filter((e) => e.isFile() && matchable(e.name))
      .map((e) => e.name)
      .sort()
    const t1 = performance.now()
    let t2 = t1
    if (files.length > keep) {
      const doomed = files.slice(0, -keep)
      await Promise.all(doomed.map((f) => fs.unlink(path.join(dir, f)).catch(() => {})))
      t2 = performance.now()
    }
    console.log(
      `N=${String(N).padStart(4)}  matched=${String(files.length).padStart(4)}  ` +
        `readdir+sort=${(t1 - t0).toFixed(1)}ms  unlink=${(t2 - t1).toFixed(1)}ms  ` +
        `TOTAL=${(t2 - t0).toFixed(1)}ms`,
    )
    await fs.rm(dir, { recursive: true, force: true })
  }
})()
