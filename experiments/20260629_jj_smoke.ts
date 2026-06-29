/**
 * jj smoke tests v4 — correct workflow
 * Snapshot = "jj new -m <desc>" → parent (@-) auto-commits WC state.
 * Restore = "jj restore --from <change-id> [file]"
 * Diff = "jj diff --git --from <a> --to <b>"
 */
import { $ } from "bun"
import fs from "fs"

const JJ = "D:/zPython/opencode/tools/jj.exe"

const tmp = "D:/zPython/opencode/.temp/jj-smoke"
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
fs.mkdirSync(tmp, { recursive: true })
process.chdir(tmp)

let ok = 0, fail = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) { ok++; console.log(`  [OK] ${name}`) }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? `: ${detail}` : ""}`) }
}

async function jj(cmd: string) {
  const result = await $`${{ raw: `${JJ} ${cmd}` }}`.nothrow().quiet()
  return { code: result.exitCode, text: result.stdout.toString().trim(), err: result.stderr.toString().trim() }
}

// Snapshot: fork WC → parent (@-) is the snapshot
async function snap(desc: string) {
  const r = await jj(`new -m "${desc}"`)
  if (r.code !== 0) return null
  const log = await jj(`log -r @- --no-graph -T "change_id"`)
  return log.text || null
}

// ── 1. Init ────────────────────────────────────────────────────────────────
console.log("\n=== 1. Init ===")
const init = await jj("git init")
check("jj git init", init.code === 0, init.err)

// ── 2. Snapshots ───────────────────────────────────────────────────────────
console.log("\n=== 2. Snapshots ===")
fs.writeFileSync("hello.txt", "hello world\n")
const s1 = await snap("s1")
check("snap1", !!s1 && s1.length > 10, s1 || "null")
console.log(`    snap1=${s1?.slice(0,12)}...`)

fs.writeFileSync("world.txt", "goodbye\n")
const s2 = await snap("s2")
check("snap2", !!s2 && s2.length > 10, s2 || "null")
console.log(`    snap2=${s2?.slice(0,12)}...`)
check("s1 != s2", s1 !== s2)

// ── 3. Diff ────────────────────────────────────────────────────────────────
console.log("\n=== 3. Diff ===")
const gitdiff = await jj(`diff --git --from ${s1} --to ${s2}`)
check("git diff includes world.txt", gitdiff.text.includes("world.txt") || gitdiff.text.includes("goodbye"), gitdiff.text.slice(0, 100))

const summary = await jj(`diff --summary --from ${s1} --to ${s2}`)
check("summary includes world.txt", summary.text.includes("world.txt"), summary.text.slice(0, 100))

// ── 4. Per-file restore ────────────────────────────────────────────────────
console.log("\n=== 4. Per-file restore ===")
fs.writeFileSync("hello.txt", "MODIFIED\n")
const fr = await jj(`restore --from ${s1} hello.txt`)
check("restore ok", fr.code === 0, fr.err)
check("restored content", fs.readFileSync("hello.txt", "utf8") === "hello world\n")

// ── 5. Full restore ────────────────────────────────────────────────────────
console.log("\n=== 5. Full restore ===")
fs.writeFileSync("hello.txt", "bad\n")
fs.writeFileSync("world.txt", "bad\n")
const full = await jj(`restore --from ${s1}`)
check("full restore ok", full.code === 0, full.err)
check("hello restored", fs.readFileSync("hello.txt", "utf8") === "hello world\n")
check("world gone", !fs.existsSync("world.txt"))

// ── 6. Restore forward ─────────────────────────────────────────────────────
console.log("\n=== 6. Restore forward ===")
const fwd = await jj(`restore --from ${s2}`)
check("fwd restore ok", fwd.code === 0, fwd.err)
check("world back", fs.existsSync("world.txt"))

// ── 7. Batch 50 ────────────────────────────────────────────────────────────
console.log("\n=== 7. Batch 50 ===")
for (let i = 0; i < 50; i++) fs.writeFileSync(`b${i}.txt`, `content ${i}\n`)
const sBatch = await snap("batch50")
check("batch snap", !!sBatch, sBatch || "null")
for (let i = 0; i < 50; i++) fs.writeFileSync(`b${i}.txt`, `MOD ${i}\n`)
const br = await jj(`restore --from ${sBatch}`)
check("batch restore ok", br.code === 0, br.err)
let allOk = true
for (let i = 0; i < 50; i++) {
  if (fs.readFileSync(`b${i}.txt`, "utf8") !== `content ${i}\n`) allOk = false
}
check("all 50 OK", allOk)

// ── 8. File list ───────────────────────────────────────────────────────────
console.log("\n=== 8. File list ===")
const fl = await jj(`file list -r ${s2}`)
check("file list ok", fl.code === 0, fl.err)
check("hello listed", fl.text.includes("hello.txt"))
check("world listed", fl.text.includes("world.txt"))

// ── 9. Delete + restore ────────────────────────────────────────────────────
console.log("\n=== 9. Delete + restore ===")
fs.unlinkSync("hello.txt")
const sd = await snap("deleted")
check("del snap", !!sd, sd || "null")
check("hello gone", !fs.existsSync("hello.txt"))
const dr = await jj(`restore --from ${sd}`)
check("del restore ok", dr.code === 0, dr.err)
check("hello back", fs.existsSync("hello.txt"))

// ── 10. Diff name-only ─────────────────────────────────────────────────────
console.log("\n=== 10. Diff name-only ===")
const names = await jj(`diff --summary --from ${s1} --to ${s2}`)
check("summary code", names.code === 0, names.err)
console.log("    output:", names.text.slice(0, 200))

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n=== Result: ${ok} pass, ${fail} fail ===`)

process.chdir("D:/zPython/opencode")
setTimeout(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}, 1000)
process.exit(fail > 0 ? 1 : 0)
