import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

const control = process.cwd()
await fs.writeFile(path.join(control, "sync-entered"), JSON.stringify({ pid: process.pid }))
const deadline = Date.now() + 2_000
while (!existsSync(path.join(control, "sync-release"))) {
  if (Date.now() > deadline) process.exit(1)
  await Bun.sleep(10)
}
