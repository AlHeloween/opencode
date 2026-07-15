/** @jsxImportSource @opentui/solid */
/**
 * WebGPU smoke test — validates that image-plane (Three.js + WebGPU) initializes
 * without crashing. Run via: bun run experiments/tui-image-rendering/smoketest-webgpu.tsx
 */
import { render, extend } from "@opentui/solid"
import { resolveDxcDlls } from "../../src/util/resolve-dxc"
import { TexturePlaneRenderable } from "../../src/cli/cmd/tui/component/texture-plane-renderable"
import { writeFileSync } from "fs"

const LOG = "D:/zPython/opencode/.temp/smoketest-webgpu.log"

function log(msg: string) {
  try { writeFileSync(LOG, `${new Date().toISOString()} ${msg}\n`, { flag: "a" }) } catch {}
  console.log(msg)
}

log("=== WebGPU smoke test starting ===")

// Step 1: Resolve DXC DLLs (Windows-only, needed for Dawn/WebGPU)
log("resolveDxcDlls...")
resolveDxcDlls()
log("resolveDxcDlls OK")

// Step 2: Register image-plane renderable
log("extend image-plane...")
try {
  extend({ "image-plane": TexturePlaneRenderable })
  log("extend OK")
} catch (e) {
  log(`extend FAILED: ${String(e)}`)
  process.exit(1)
}

// Step 3: Render a tiny test image (1×1 transparent PNG in base64)
const TEST_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg=="

function App() {
  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1} gap={1}>
      <text>WebGPU Smoke Test</text>
      <image-plane url={TEST_PNG} mime="image/png" width={1} height={1} />
    </box>
  )
}

log("calling render()...")
const start = Date.now()
render(() => <App />)
  .then(() => {
    log(`render OK in ${Date.now() - start}ms — WebGPU initialized successfully`)
    process.exit(0)
  })
  .catch((err: any) => {
    log(`FATAL: ${err?.stack || err?.message || String(err)}`)
    process.exit(1)
  })
