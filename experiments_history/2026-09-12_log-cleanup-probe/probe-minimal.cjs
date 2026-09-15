const fs = require("fs/promises")
const path = require("path")
const os = require("os")

;(async () => {
  for (const N of [50, 150, 300, 800]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cg-"))
    const names = []
    for (let i = 0; i < N; i++) {
      const n = String(1700000000000 + i) + "_log_system_internal.jsonl"
      await fs.writeFile(path.join(dir, n), '{"x":1}')
      names.push(n)
    }
    names.sort()
    const doomed = names.slice(0, -100)

    const t0 = performance.now()
    await fs.readdir(dir, { withFileTypes: true })
    const t1 = performance.now()

    const t2 = performance.now()
    await Promise.all(doomed.map((f) => fs.unlink(path.join(dir, f)).catch(() => {})))
    const t3 = performance.now()

    console.log(
      "N=" + N + "  readdir=" + (t1 - t0).toFixed(1) + "ms  unlink=" + doomed.length + " -> " + (t3 - t2).toFixed(1) + "ms",
    )
    await fs.rm(dir, { recursive: true, force: true })
  }
})()
