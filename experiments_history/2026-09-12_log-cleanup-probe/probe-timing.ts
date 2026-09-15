import fs from "fs/promises"
import path from "path"
import os from "os"

for (const N of [50, 150, 300]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cg-"))
  const names: string[] = []
  for (let i = 0; i < N; i++) {
    const n = String(1700000000000 + i) + "_log_system_internal.jsonl"
    await fs.writeFile(path.join(dir, n), '{"x":1}')
    names.push(n)
  }
  names.sort()
  const doomed = names.slice(0, -100)
  const t0 = performance.now()
  await Promise.all(
    doomed.map((f) =>
      fs.unlink(path.join(dir, f)).catch(() => {
        /* ignore */
      }),
    ),
  )
  const t1 = performance.now()
  console.log(`N=${N}  unlink=${doomed.length}  ${(t1 - t0).toFixed(1)}ms`)

  const t2 = performance.now()
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const t3 = performance.now()
  console.log(`   readdir(${entries.length}) ${(t3 - t2).toFixed(1)}ms`)
  await fs.rm(dir, { recursive: true, force: true })
}
