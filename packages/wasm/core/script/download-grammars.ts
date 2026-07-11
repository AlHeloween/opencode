/**
 * Download tree-sitter WASM grammars to local cache.
 * Run: bun run packages/wasm/core/script/download-grammars.ts
 *
 * Handles three sources:
 *   1. HTTP/HTTPS URLs — downloaded from the web (e.g. GitHub releases)
 *   2. npm package paths — copied from node_modules/<pkg>/<file>
 *   3. Local file references — copied from the source path
 */
import fs from "fs"
import path from "path"
import { createRequire } from "module"

const CONFIG_PATH = path.resolve(import.meta.dir, "../../../opencode/parsers-config.ts")
const GRAMMAR_DIR = path.resolve(import.meta.dir, "../pkg/grammars")
/** Root of the monorepo (4 levels up from script dir) */
const MONOREPO_ROOT = path.resolve(import.meta.dir, "../../..")

const require = createRequire(import.meta.url)

const configSrc = fs.readFileSync(CONFIG_PATH, "utf-8")
const wasmUrls = [...configSrc.matchAll(/wasm:\s*"([^"]+)"/g)].map((m) => m[1])

fs.mkdirSync(GRAMMAR_DIR, { recursive: true })

/**
 * Try to find a WASM file from an npm package.
 * Works for grammars installed as npm dependencies (tree-sitter-powershell, tree-sitter-batch, etc.)
 */
function resolveNpmWasmPath(filename: string): string | null {
  // Trim known prefixes to derive the package name
  // e.g. "tree-sitter-powershell.wasm" → package "tree-sitter-powershell"
  const knownPackages = [
    "tree-sitter-powershell",
    "tree-sitter-batch",
    "tree-sitter-markdown",
    "tree-sitter-markdown-inline",
  ]

  for (const pkg of knownPackages) {
    const expectedFile = pkg.replace(/-/g, "_") === filename.replace(".wasm", "").replace(/-/g, "_")
      || pkg + ".wasm" === filename
    if (expectedFile || filename.startsWith(pkg.replace(/-/g, "_"))) {
      try {
        // Resolve the package's WASM file path
        const pkgJsonPath = require.resolve(pkg + "/package.json")
        const pkgDir = path.dirname(pkgJsonPath)
        // Look for the WASM file in the package root
        const wasmPath = path.join(pkgDir, filename)
        if (fs.existsSync(wasmPath)) return wasmPath
        // Also check common subpaths
        for (const sub of ["", "wasm", "dist"]) {
          const candidate = path.join(pkgDir, sub, filename)
          if (fs.existsSync(candidate)) return candidate
        }
      } catch {
        // Package not installed, skip
      }
    }
  }
  return null
}

let downloaded = 0
let skipped = 0
let local = 0
let copied = 0
let failed = 0

for (const url of wasmUrls) {
  if (!url) continue

  // Extract filename from URL or local path
  const filename = path.basename(url.split("?")[0])
  const dest = path.join(GRAMMAR_DIR, filename)

  if (fs.existsSync(dest)) {
    skipped++
    continue
  }

  // HTTP/HTTPS — download from the web
  if (url.startsWith("http://") || url.startsWith("https://")) {
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
    continue
  }

  // Local path — try npm package first, then relative path
  const npmWasm = resolveNpmWasmPath(filename)
  if (npmWasm) {
    try {
      process.stdout.write(`  ${filename} (npm) ... `)
      fs.copyFileSync(npmWasm, dest)
      console.log(`OK (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`)
      copied++
      continue
    } catch (e: any) {
      console.log(`FAILED COPY: ${e.message}`)
    }
  }

  // Try resolving as a relative path from the monorepo root
  const localPath = path.resolve(MONOREPO_ROOT, url)
  if (fs.existsSync(localPath)) {
    try {
      process.stdout.write(`  ${filename} (local) ... `)
      fs.copyFileSync(localPath, dest)
      console.log(`OK (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`)
      copied++
      continue
    } catch (e: any) {
      console.log(`FAILED COPY: ${e.message}`)
    }
  }

  local++
}

console.log(`\n${downloaded} downloaded, ${copied} copied, ${skipped} cached, ${local} skipped, ${failed} failed`)
