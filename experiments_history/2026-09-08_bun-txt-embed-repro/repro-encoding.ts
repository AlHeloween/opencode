// ENCODING test: the real txt may carry BOM/CRLF; synthetic files don't.
// Build matrix: (a) real file as-is from disk (raw bytes, incl. any BOM/CRLF)
// vs (b) normalized copy (UTF-8 no BOM, LF). If (a) fails and (b) passes ->
// encoding is the loader switch.
import path from "path"
import fs from "fs"

const dir = "D:/zPython/opencode/experiments/2026-09-08_bun-txt-embed-repro"
const realPath = "D:/zPython/opencode/packages/opencode/src/session/prompt/reasoning_prompt.txt"
const raw = fs.readFileSync(realPath)
console.log("first bytes:", [...raw.subarray(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join(" "))
console.log("has BOM:", raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
console.log("has CRLF:", raw.includes(Buffer.from("\r\n")))

const variants: [string, Buffer][] = [
  ["raw", raw],
  ["nolf", Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n"), "utf8")],
  ["nobom", raw[0] === 0xef ? Buffer.from(raw.subarray(3)) : raw],
]

for (const [tag, buf] of variants) {
  const txtPath = path.join(dir, `enc_${tag}.txt`)
  fs.writeFileSync(txtPath, buf)
  const entry = path.join(dir, `entry_enc_${tag}.ts`)
  fs.writeFileSync(entry, `import t from "./enc_${tag}.txt"\nconsole.log(typeof t)\n`)
  const out = path.join(dir, `probe_enc_${tag}.exe`)
  await Bun.build({ entrypoints: [entry], root: dir, target: "bun", compile: { outfile: out } })
  const bin = fs.readFileSync(out).toString("latin1")
  const head = buf.toString("utf8").slice(3, 20).replace(/["\\\n\r]/g, "")
  console.log(tag.padEnd(6), "| WORKFLOW-in-bytes:", bin.includes(head))
}
