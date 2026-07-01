/**
 * Download tree-sitter WASM grammars to local cache.
 * Run: bun run packages/wasm/core/script/download-grammars.ts
 */
import fs from "fs"
import path from "path"

const CONFIG_PATH = path.resolve(import.meta.dir, "../../../opencode/parsers-config.ts")
const GRAMMAR_DIR = path.resolve(import.meta.dir, "../pkg/grammars")

const configSrc = fs.readFileSync(CONFIG_PATH, "utf-8")
const wasmUrls = [...configSrc.matchAll(/wasm:\s*"([^"]+)"/g)].map((m) => m[1])

fs.mkdirSync(GRAMMAR_DIR, { recursive: true })

let downloaded = 0
let skipped = 0
let local = 0
let failed = 0

for (const url of wasmUrls) {
  if (!url) continue
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    local++
    continue
  }
  const filename = path.basename(new URL(url).pathname)
  const dest = path.join(GRAMMAR_DIR, filename)
  if (fs.existsSync(dest)) {
    skipped++
    continue
  }
  try {
    process.stdout.write(`  ${filename} ... `)
    const resp = await fetch(url, { redirect: "follow" })
    if (!resp.ok) {
      console.log(`FAILED HTTP ${resp.status}`)
      failed++
      continue
    }
    fs.writeFileSync(dest, Buffer.from(await resp.arrayBuffer()))
    console.log(`OK (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`)
    downloaded++
  } catch (e: any) {
    console.log(`FAILED ${e.message}`)
    failed++
  }
}

console.log(`\n${downloaded} downloaded, ${skipped} cached, ${local} local, ${failed} failed`)
