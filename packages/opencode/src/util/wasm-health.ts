/**
 * Startup health check for packaged WASM modules.
 * Called once at app init. Logs FATAL errors if any module fails to load.
 */
import { initDiffy } from "./diff-wasm"
import { initTokenizer } from "@/tokenizers/bpe-wasm"
import { initJsonRepair } from "./json-repair-wasm"
import { initPathValidator } from "./path-validator"
import * as Log from "@opencode-ai/core/util/log"
import { embeddedTreeSitterGrammarAssetPaths } from "./wasm-embedded"
import { readWasmAsset } from "./wasm-path"

function checkAsset(name: string, relativePath: string) {
  return readWasmAsset(relativePath)
    .then((asset) => ({ name, ok: asset.bytes !== null }))
    .catch((err) => {
      Log.Default.error("wasm-health: " + name + " check failed: " + (err instanceof Error ? err.message : String(err)))
      return { name, ok: false }
    })
}

export async function checkWasmModules(): Promise<void> {
  const results = await Promise.all([
    initDiffy().then((ok) => ({ name: "diffy", ok })),
    initTokenizer().then((ok) => ({ name: "tokenizer", ok })),
    initJsonRepair().then((ok) => ({ name: "json_repair", ok })),
    initPathValidator().then((ok) => ({ name: "path_validator", ok })),
    checkAsset("markdownify", "markdownify/markdownify_wasm_bg.wasm"),
    checkAsset("rdiff", "rdiff/rdiff_bg.wasm"),
    checkAsset("tree_sitter_runtime", "tree-sitter.wasm"),
    ...embeddedTreeSitterGrammarAssetPaths.map((asset) =>
      checkAsset(asset.replace("grammars/tree-sitter-", "tree_sitter_").replace(".wasm", ""), asset),
    ),
  ])

  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    const names = failed.map((r) => r.name).join(", ")
    Log.Default.error("wasm-health: FATAL - " + failed.length + " module(s) failed: " + names)
  } else {
    Log.Default.info("wasm-health: all " + results.length + " modules loaded")
  }
}
