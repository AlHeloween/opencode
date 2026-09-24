import { readFileSync } from "node:fs"
import { renderIntegrityReport } from "../../packages/opencode/src/provider/gateway/raw-diff"

const capture = process.argv[2]
const raw = JSON.parse(readFileSync(capture, "utf8"))
const body = typeof raw.body === "string" ? JSON.parse(raw.body) : raw.body

console.log(`capture: ${capture}`)
console.log(renderIntegrityReport({ body }))
