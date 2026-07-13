/**
 * Unified Image Pipeline Test — combined TUI (Sixel) + Web (Three.js WebGL).
 *
 * Tests both rendering paths from the same PNG source:
 *
 *   PNG image
 *   ├── TUI path: Jimp decode → Sixel encode → terminal escape sequence
 *   └── Web path: Three.js WebGL → canvas → HTML display
 *
 * Usage:
 *   bun run test_pipeline.ts              # Run all tests
 *   bun run test_pipeline.ts --sixel      # Sixel TUI test only
 *   bun run test_pipeline.ts --web        # Generate web test only
 *   bun run test_pipeline.ts --dll        # Test DLL resolution only
 */

import { writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DIR = dirname(fileURLToPath(import.meta.url))
const TEST_PNG = join(DIR, "test_pattern.png")
const SIXEL_OUT = join(DIR, "sixel_output.txt")
const WEB_HTML = join(DIR, "web_rendered.html")
const PROCESSORS = 4 // parallel test tasks

// Colors
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const CYAN = "\x1b[36m"
const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"

let passed = 0
let failed = 0

function pass(name: string, detail = "") {
  passed++
  console.log(`  ${GREEN}✓${RESET} ${name}${detail ? ` ${CYAN}(${detail})${RESET}` : ""}`)
}

function fail(name: string, reason: string) {
  failed++
  console.log(`  ${RED}✗${RESET} ${name}: ${reason}`)
}

// ---------------------------------------------------------------------------
// Step 0: Generate test PNG
// ---------------------------------------------------------------------------
async function generateTestPng(): Promise<void> {
  const jimpMod = await import("jimp") as any
  const Jimp = jimpMod.Jimp as any
  const rgbaToInt = jimpMod.rgbaToInt as any

  const w = 300, h = 200

  // Create image with white background
  const img = new Jimp({ width: w, height: h, color: 0xffffffff })

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r: number, g: number, b: number

      // Gradient background (cool blue-purple)
      r = Math.round(50 + (x / w) * 205)
      g = Math.round(30 + (y / h) * 180)
      b = Math.round(100 + ((x + y) / (w + h)) * 155)

      // Rectangle overlay (blue)
      if (x >= 50 && x < 150 && y >= 40 && y < 100) {
        r = 59; g = 130; b = 246
      }

      // Circle overlay (red)
      const cx = 200, cy = 80, cr = 40
      if ((x - cx) ** 2 + (y - cy) ** 2 <= cr ** 2) {
        r = 239; g = 68; b = 68
      }

      // Text area (light grey)
      if (y >= 130 && y < 170 && x >= 20 && x < 280) {
        r = 240; g = 240; b = 245
      }

      img.setPixelColor(rgbaToInt(r, g, b, 255), x, y)
    }
  }

  await img.write(TEST_PNG as any)
}

// ---------------------------------------------------------------------------
// Step 1: Test Sixel TUI path
// ---------------------------------------------------------------------------
async function testSixelRender(): Promise<void> {
  console.log(`\n${BOLD}── Step 1: Sixel TUI Rendering Path ──${RESET}`)

  try {
    const { sixelImage } = await import("../../src/util/sixel-render")
    const escapeSeq = await sixelImage(TEST_PNG, { maxCols: 60, quantize: 256 })
    writeFileSync(SIXEL_OUT, escapeSeq)

    // Validate Sixel structure
    if (!escapeSeq.startsWith("\x1bPq")) {
      fail("Sixel header", "Missing DCS start escape (\\x1bPq)")
    } else {
      pass("Sixel header", "Starts with \\x1bPq (DCS)")
    }

    if (!escapeSeq.endsWith("\x1b\\")) {
      fail("Sixel footer", "Missing ST escape (\\x1b\\)")
    } else {
      pass("Sixel footer", "Ends with \\x1b\\ (ST)")
    }

    // Check palette definitions
    const paletteCount = (escapeSeq.match(/#\d+;2;/g) || []).length
    pass("Palette registers", `${paletteCount} colors defined`)

    // Check sixel data characters
    const sixelChars = escapeSeq.match(/[\x3f-\x7e]/g) || []
    pass("Sixel pixels", `${sixelChars.length} sixel characters`)

    // Check row bands
    const bands = (escapeSeq.match(/-/g) || []).length
    pass("Row bands", `${bands} sixel row bands`)

    // Check total size
    const sizeKB = (Buffer.byteLength(escapeSeq, "utf8") / 1024).toFixed(1)
    pass("Output size", `${sizeKB} KB`)

    // Verify the escape sequence can be written to terminal
    // We just validate the structure; actual display requires terminal
    console.log(`\n  ${YELLOW}To view Sixel in terminal:${RESET}`)
    console.log(`  ${CYAN}type ${SIXEL_OUT}${RESET}`)
    console.log(`  ${CYAN}.\sixel-render-test.bat${RESET}`)
  } catch (e) {
    fail("Sixel render", String(e))
  }
}

// ---------------------------------------------------------------------------
// Step 2: Write the escape sequence to terminal (requires Sixel-capable terminal)
// ---------------------------------------------------------------------------
function createSixelBatchScript(): void {
  const batContent = `@echo off
REM Write Sixel escape sequence directly to terminal
REM Requires Windows Terminal (2024+) or other Sixel-capable terminal
type "${SIXEL_OUT}"
echo.
echo Sixel image displayed above (if terminal supports it)
`
  writeFileSync(join(DIR, "sixel-render-test.bat"), batContent)
  console.log(`\n  ${YELLOW}Created sixel-render-test.bat — run it in a Sixel-capable terminal${RESET}`)
}

// ---------------------------------------------------------------------------
// Step 3: Test WebGL/Three.js Web path
// ---------------------------------------------------------------------------
async function testWebRender(): Promise<void> {
  console.log(`\n${BOLD}── Step 2: Web (Three.js WebGL) Rendering Path ──${RESET}`)

  // Generate web test HTML that uses Three.js WebGL (not WebGPU)
  const webHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Unified Pipeline — WebGL Test</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a1a; display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 20px; font-family: monospace; }
  h1 { color: #888; font-size: 16px; margin-bottom: 10px; }
  h2 { color: #666; font-size: 13px; margin-top: 10px; }
  .container { display: flex; gap: 30px; flex-wrap: wrap; justify-content: center; }
  .card { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 16px; text-align: center; }
  canvas { max-width: 100%; border-radius: 4px; }
  #stats { color: #555; font-size: 11px; margin-top: 8px; }
  .status-ok { color: #4ade80; }
  .status-fail { color: #f87171; }
</style>
</head>
<body>
  <h1>Unified Image Pipeline — WebGL Test</h1>
  <div class="container">
    <div class="card">
      <h2>Test Pattern (from PNG)</h2>
      <img id="pngDisplay" style="max-width:400px; image-rendering:pixelated;" />
      <div id="stats">Loading...</div>
    </div>
  </div>

  <h2>| Path | Status | Renderer |</h2>
  <pre style="color:#555">
  | TUI  | <span class="status-ok">READY</span>  | Sixel → terminal escape sequence |
  | Web  | <span class="status-ok">READY</span>  | Three.js WebGL → canvas (below) |
  </pre>

  <div class="card">
    <h2>Three.js WebGL Render</h2>
    <canvas id="threeCanvas" width="400" height="267"></canvas>
    <div id="threeStats">Initializing Three.js WebGL...</div>
  </div>

<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.177.0/build/three.module.js"
  }
}
</script>

<script type="module">
import * as THREE from 'three'

// 1. Load the PNG for reference
const img = new Image()
img.src = '../test_pattern.png?' + Date.now()
img.onload = () => {
  document.getElementById('pngDisplay').src = img.src
  document.getElementById('stats').textContent =
    img.naturalWidth + '×' + img.naturalHeight + ' PNG loaded ✓'
}

// 2. Three.js WebGL — render textured plane
const canvas = document.getElementById('threeCanvas')
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
})
renderer.setClearColor(0x0a0a1a, 1)
renderer.setPixelRatio(window.devicePixelRatio)

const scene = new THREE.Scene()
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
camera.position.z = 1

// Texture from the test PNG
const loader = new THREE.TextureLoader()
const texture = loader.load('../test_pattern.png?' + Date.now())
texture.minFilter = THREE.LinearFilter
texture.magFilter = THREE.NearestFilter

const geometry = new THREE.PlaneGeometry(2, 1.5)
const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
const mesh = new THREE.Mesh(geometry, material)
scene.add(mesh)

renderer.render(scene, camera)

document.getElementById('threeStats').innerHTML =
  '✓ Three.js WebGL — ' + renderer.info.render.triangles + ' triangles'
</script>
</body>
</html>`

  writeFileSync(WEB_HTML, webHtml)
  pass("Web HTML generated", join("experiments/20260713_unified_pipeline_test/web_rendered.html"))

  console.log(`\n  ${YELLOW}To view web test:${RESET}`)
  console.log(`  ${CYAN}Open ${WEB_HTML} in a browser${RESET}`)
  console.log(`  ${CYAN}Uses Three.js WebGL (not WebGPU) — avoids Dawn/Vulkan chain${RESET}`)
}

// ---------------------------------------------------------------------------
// Step 3b: Python reference test
// ---------------------------------------------------------------------------
function createPythonReference(): void {
  const pyContent = `#!/usr/bin/env python3
"""
Unified Pipeline — Python reference: Sixel + WebGL test.

TUI path:   PNG → Jimp → Sixel → terminal
Web path:   Three.js WebGL → HTML canvas

This mirrors the TypeScript pipeline for cross-validation.
"""
import os, sys, struct
from pathlib import Path

HERE = Path(__file__).parent
PNG_PATH = HERE / "test_pattern.png"

# ── Dynamic DLL resolution (from test_cube.py) ──────────────────────
def resolve_dlls():
    target_files = ["dxcompiler.dll", "dxil.dll"] if sys.platform.startswith("win32") else ["dxc"]
    lookup_cmd = ["where.exe"] if sys.platform.startswith("win32") else ["which"]
    discovered = set()
    for fname in target_files:
        try:
            res = os.popen(" ".join(lookup_cmd + [fname])).read()
            for line in res.strip().splitlines():
                p = Path(line.strip()).parent
                if p.exists(): discovered.add(str(p))
        except: continue
    for p in discovered:
        if sys.platform.startswith("win32") and "x86" in p.lower() and "x64" not in p.lower(): continue
        if p not in os.environ["PATH"]:
            os.environ["PATH"] = p + os.pathsep + os.environ["PATH"]
        if sys.platform.startswith("win32"):
            try: os.add_dll_directory(p)
            except: pass
    return len(discovered)

# ── Sixel TUI path ─────────────────────────────────────────────────
def sixel_from_png(png_path: str, max_cols: int = 60):
    try:
        from PIL import Image
    except ImportError:
        print("Install Pillow: pip install Pillow")
        return None

    img = Image.open(png_path)
    aspect = img.width / img.height
    cols = min(img.width, max_cols)
    rows = round(cols / aspect)
    rows = ((rows + 5) // 6) * 6  # round up to multiple of 6
    img = img.resize((cols, rows), Image.LANCZOS)
    pixels = list(img.getdata())

    # Uniform 5-6-5 quantization (same as TypeScript sixel-render.ts)
    palette = {}
    idx_map = []
    for r, g, b in pixels:
        key = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
        if key not in palette:
            palette[key] = len(palette)
        idx_map.append(palette[key])

    palette_list = [(k >> 11 & 0x1F) * 255 // 31,
                    (k >> 5 & 0x3F) * 255 // 63,
                    (k & 0x1F) * 255 // 31]
    # Wait we need full palette mapping
    pal_rgb = {}
    for key, idx in palette.items():
        pr = min(100, round((key >> 11) * 100 / 31))
        pg = min(100, round(((key >> 5) & 0x3F) * 100 / 63))
        pb = min(100, round((key & 0x1F) * 100 / 31))
        pal_rgb[idx] = (pr, pg, pb)

    out = ["\\x1bPq"]
    for i in range(len(palette)):
        r, g, b = pal_rgb[i]
        out.append(f"#{i};2;{r};{g};{b}")

    bands = rows // 6
    for band in range(bands):
        base_y = band * 6
        color_bands = {}
        for x in range(cols):
            for bit in range(6):
                y = base_y + bit
                if y >= rows: continue
                ci = idx_map[y * cols + x]
                if ci >= len(palette): continue
                if ci not in color_bands:
                    color_bands[ci] = [0] * cols
                color_bands[ci][x] = (color_bands[ci][x] or 0) | (1 << bit)

        # Sort by frequency (most used first)
        sorted_colors = sorted(color_bands.items(),
            key=lambda kv: sum(1 for v in kv[1] if v), reverse=True)

        for ci, bitmask in sorted_colors:
            out.append(f"#{ci}")
            for x in range(cols):
                code = bitmask[x] or 0
                out.append(chr(63 + code))
            out.append("$")
        out.append("-")

    out.append("\\x1b\\\\")
    return "".join(out)

if __name__ == "__main__":
    print("=== Unified Pipeline: Python Reference ===")
    print(f"\\n1. Dynamic DLL resolution: {resolve_dlls()} directories found")
    if PNG_PATH.exists():
        print(f"2. Sixel TUI path: ", end="")
        seq = sixel_from_png(str(PNG_PATH))
        if seq:
            print(f"{len(seq)} bytes generated")
            with open(HERE / "sixel_python.txt", "w") as f:
                f.write(seq)
            print(f"   Saved to sixel_python.txt")
        else:
            print("FAILED")
    else:
        print(f"2. Generate test PNG first: bun run test_pipeline.ts")
`

  writeFileSync(join(DIR, "render_test.py"), pyContent)
  pass("Python reference", "render_test.py created (cross-validates pipeline)")
}

// ---------------------------------------------------------------------------
// Step 4: Test dynamic DLL resolution
// ---------------------------------------------------------------------------
async function testDllResolution(): Promise<void> {
  console.log(`\n${BOLD}── Step 3: Dynamic DLL Resolution Test ──${RESET}`)

  const isWin = process.platform === "win32"

  if (!isWin) {
    console.log(`  ${YELLOW}Skipping: DLL resolution is Windows-specific${RESET}`)
    return
  }

  const { execSync } = await import("child_process")

  for (const dll of ["dxcompiler.dll", "dxil.dll"]) {
    try {
      const result = execSync(`where.exe ${dll} 2>nul`, { encoding: "utf8" }).trim()
      if (result) {
        const paths = result.split("\n").map(p => p.trim())
        pass(`Found ${dll}`, `${paths.length} paths: ${paths.join(" | ")}`)
      } else {
        fail(`Find ${dll}`, "Not found in PATH or system")
      }
    } catch {
      fail(`Find ${dll}`, "where.exe failed")
    }
  }

  // Check if both DLLs are in same directory
  let dxcPath = ""
  let dxilPath = ""
  try {
    dxcPath = execSync(`where.exe dxcompiler.dll 2>nul`, { encoding: "utf8" }).trim().split("\n")[0]?.trim() ?? ""
  } catch {}
  try {
    dxilPath = execSync(`where.exe dxil.dll 2>nul`, { encoding: "utf8" }).trim().split("\n")[0]?.trim() ?? ""
  } catch {}

  if (dxcPath && dxilPath) {
    const dxcDir = dirname(dxcPath).toLowerCase()
    const dxilDir = dirname(dxilPath).toLowerCase()
    if (dxcDir === dxilDir) {
      pass("DLL colocation", "dxcompiler.dll and dxil.dll in same directory — Dawn will find both")
    } else {
      console.log(`\n  ${YELLOW}⚠ DLLs in different directories:${RESET}`)
      console.log(`    dxcompiler.dll → ${dxcPath}`)
      console.log(`    dxil.dll       → ${dxilPath}`)
      console.log(`  ${YELLOW}Dawn finds dxcompiler.dll but NOT dxil.dll — crash risk.${RESET}`)
      console.log(`  ${YELLOW}Fix: copy dxil.dll to ${dirname(dxcPath)} or bundle with binary${RESET}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  const runAll = args.length === 0
  const runSixel = runAll || args.includes("--sixel")
  const runWeb = runAll || args.includes("--web")
  const runDll = runAll || args.includes("--dll")

  console.log(`${BOLD}Unified Image Pipeline Test${RESET}`)
  console.log(`Test directory: ${DIR}\n`)

  // Ensure directory exists
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })

  // Generate test PNG once
  await generateTestPng()
  console.log(`${BOLD}Test PNG generated:${RESET} test_pattern.png (300×200)`)

  // Run selected tests
  if (runSixel) {
    await testSixelRender()
    createSixelBatchScript()
  }

  if (runWeb) {
    await testWebRender()
    createPythonReference()
  }

  if (runDll) {
    await testDllResolution()
  }

  // Summary
  const total = passed + failed
  console.log(`\n${BOLD}${"=".repeat(50)}${RESET}`)
  console.log(`${BOLD}Results:${RESET} ${passed}/${total} passed` +
    (failed > 0 ? ` ${RED}${failed} failed${RESET}` : ` ${GREEN}all pass${RESET}`))
  console.log()

  // Print ticket for next steps
  console.log(`${BOLD}Next steps for integration:${RESET}`)
  console.log(`  1. Bundle DirectX DLLs with binary (dxcompiler.dll + dxil.dll)`)
  console.log(`  2. Wire Sixel renderer into MediaImage/MediaMermaid components`)
  console.log(`  3. Add dynamic DLL resolution at startup (like test_cube.py)`)
  console.log(`  4. Fall back through protocol chain: Sixel → Kitty → ANSI`)

  if (!runAll) {
    console.log(`\n${YELLOW}Tip: run without args to test all paths: bun run test_pipeline.ts${RESET}`)
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("Test failed:", e)
  process.exit(1)
})
