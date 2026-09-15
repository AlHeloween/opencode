import fs from "fs/promises"
import path from "path"
import os from "os"

const keep = 100
const pattern = /^\d{13}_(log|diff|payload)_.+\.(jsonl|diff|json|md)$/

async function bench(n: number, hold: boolean) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cg-bench-"))
  const names: string[] = []
  const handles: fs.FileHandle[] = []
  for (let i = 0; i < n; i++) {
    const name = String(1700000000000 + i) + "_log_system_internal.jsonl"
    const file = path.join(dir, name)
    await fs.writeFile(file, '{"x":1}')
    names.push(name)
    // Simulate another live process holding the file open (the real condition:
    // another opencode/TUI instance is running and still writing its log).
    if (hold) handles.push(await fs.open(file, "a"))
  }
  names.sort()

  const t0 = performance.now()
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = entries.filter((e) => e.isFile() && pattern.test(e.name)).map((e) => e.name).sort()
  const t1 = performance.now()
  if (files.length <= keep) {
    console.log(`n=${n} hold=${hold}  readdir=${(t1 - t0).toFixed(1)}ms  no cleanup`)
  } else {
    const doomed = files.slice(0, -keep)
    const t2 = performance.now()
    await Promise.all(
      doomed.map((f) => fs.unlink(path.join(dir, f)).catch(() => {})),
    )
    const t3 = performance.now()
    console.log(
      `n=${n} hold=${hold}  readdir=${(t1 - t0).toFixed(1)}ms  unlink(${doomed.length})=${(t3 - t2).toFixed(1)}ms  total=${(t3 - t0).toFixed(1)}ms`,
    )
  }
  for (const h of handles) await h.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
}

for (const n of [50, 120, 300]) {
  await bench(n, false)
}
for (const n of [50, 120, 300]) {
  await bench(n, true)
}
