/**
 * Startup health check for all Rust WASM modules.
 * Called once at app init. Logs FATAL errors if any module fails to load.
 */
import { initDiffy } from "./diff-wasm"
import { initTokenizer } from "@/tokenizers/bpe-wasm"
import { initJsonRepair } from "./json-repair-wasm"
import * as Log from "@opencode-ai/core/util/log"

export async function checkWasmModules(): Promise<void> {
  const results = await Promise.all([
    initDiffy().then((ok) => ({ name: "diffy", ok })),
    initTokenizer().then((ok) => ({ name: "tokenizer", ok })),
    initJsonRepair().then((ok) => ({ name: "json_repair", ok })),
  ])

  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    const names = failed.map((r) => r.name).join(", ")
    Log.Default.error("wasm-health: FATAL - " + failed.length + " module(s) failed: " + names)
  } else {
    Log.Default.warn("wasm-health: all " + results.length + " modules loaded")
  }
}
