/**
 * Startup health check for packaged WASM modules.
 * Called once at app init and exposed through `opencode debug wasm`.
 */
import { initDiffy } from "./diff-wasm"
import { initJsonRepair } from "./json-repair-wasm"
import { initPathValidator } from "./path-validator"
import { getMermaidWasmRenderer } from "./mermaid-wasm"
import * as Log from "@opencode-ai/core/util/log"
import { embeddedWasmAssetPaths } from "./wasm-embedded"
import { readWasmAsset } from "./wasm-path"

export type WasmHealthResult = {
  name: string
  ok: boolean
}

export type WasmHealthReport = {
  ok: boolean
  results: WasmHealthResult[]
}

function check(name: string, operation: () => Promise<boolean>): Promise<WasmHealthResult> {
  return operation()
    .then((ok) => ({ name, ok }))
    .catch((error) => {
      Log.Default.error("wasm-health: " + name + " check failed: " + (error instanceof Error ? error.message : String(error)))
      return { name, ok: false }
    })
}

function checkAsset(relativePath: string) {
  return check("asset:" + relativePath, async () => (await readWasmAsset(relativePath)).bytes !== null)
}

function checkMermaidRender() {
  return check("mermaid:render", async () => {
    const renderer = await getMermaidWasmRenderer()
    if (!renderer) return false
    return renderer.renderSvg("graph TD\\n  A --> B").includes("<svg")
  })
}

export async function checkWasmModules(): Promise<WasmHealthReport> {
  const results = await Promise.all([
    check("init:diffy", initDiffy),
    check("init:json_repair", initJsonRepair),
    check("init:path_validator", initPathValidator),
    ...embeddedWasmAssetPaths.map(checkAsset),
    checkMermaidRender(),
  ])
  const failed = results.filter((result) => !result.ok)
  if (failed.length > 0) {
    Log.Default.error("wasm-health: FATAL - " + failed.length + " check(s) failed: " + failed.map((result) => result.name).join(", "))
  } else {
    Log.Default.info("wasm-health: all " + results.length + " checks passed")
  }
  return { ok: failed.length === 0, results }
}
