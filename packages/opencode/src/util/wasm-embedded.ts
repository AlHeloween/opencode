import * as Log from "@opencode-ai/core/util/log"

import tokenizerWasm from "../../../wasm/core/pkg/tokenizer.wasm" with { type: "file" }
import diffyWasm from "../../../wasm/core/pkg/diffy/diffy_wasm_bg.wasm" with { type: "file" }
import jsonRepairWasm from "../../../wasm/core/pkg/json_repair/json_repair_bg.wasm" with { type: "file" }
import rdiffWasm from "../../../wasm/core/pkg/rdiff/rdiff_bg.wasm" with { type: "file" }
import treeSitterRuntimeWasm from "web-tree-sitter/tree-sitter.wasm" with { type: "file" }
import treeSitterBashWasm from "../../../wasm/core/pkg/grammars/tree-sitter-bash.wasm" with { type: "file" }
import treeSitterCWasm from "../../../wasm/core/pkg/grammars/tree-sitter-c.wasm" with { type: "file" }
import treeSitterCSharpWasm from "../../../wasm/core/pkg/grammars/tree-sitter-c_sharp.wasm" with { type: "file" }
import treeSitterClojureWasm from "../../../wasm/core/pkg/grammars/tree-sitter-clojure.wasm" with { type: "file" }
import treeSitterCppWasm from "../../../wasm/core/pkg/grammars/tree-sitter-cpp.wasm" with { type: "file" }
import treeSitterCssWasm from "../../../wasm/core/pkg/grammars/tree-sitter-css.wasm" with { type: "file" }
import treeSitterGoWasm from "../../../wasm/core/pkg/grammars/tree-sitter-go.wasm" with { type: "file" }
import treeSitterHaskellWasm from "../../../wasm/core/pkg/grammars/tree-sitter-haskell.wasm" with { type: "file" }
import treeSitterHclWasm from "../../../wasm/core/pkg/grammars/tree-sitter-hcl.wasm" with { type: "file" }
import treeSitterHtmlWasm from "../../../wasm/core/pkg/grammars/tree-sitter-html.wasm" with { type: "file" }
import treeSitterJavaWasm from "../../../wasm/core/pkg/grammars/tree-sitter-java.wasm" with { type: "file" }
import treeSitterJsonWasm from "../../../wasm/core/pkg/grammars/tree-sitter-json.wasm" with { type: "file" }
import treeSitterJuliaWasm from "../../../wasm/core/pkg/grammars/tree-sitter-julia.wasm" with { type: "file" }
import treeSitterKotlinWasm from "../../../wasm/core/pkg/grammars/tree-sitter-kotlin.wasm" with { type: "file" }
import treeSitterLuaWasm from "../../../wasm/core/pkg/grammars/tree-sitter-lua.wasm" with { type: "file" }
import treeSitterNixWasm from "../../../wasm/core/pkg/grammars/tree-sitter-nix.wasm" with { type: "file" }
import treeSitterOcamlWasm from "../../../wasm/core/pkg/grammars/tree-sitter-ocaml.wasm" with { type: "file" }
import treeSitterPascalWasm from "../../../wasm/core/pkg/grammars/tree-sitter-pascal.wasm" with { type: "file" }
import treeSitterPhpWasm from "../../../wasm/core/pkg/grammars/tree-sitter-php.wasm" with { type: "file" }
import treeSitterPythonWasm from "../../../wasm/core/pkg/grammars/tree-sitter-python.wasm" with { type: "file" }
import treeSitterPowerShellWasm from "tree-sitter-powershell/tree-sitter-powershell.wasm" with { type: "file" }
import treeSitterRubyWasm from "../../../wasm/core/pkg/grammars/tree-sitter-ruby.wasm" with { type: "file" }
import treeSitterRustWasm from "../../../wasm/core/pkg/grammars/tree-sitter-rust.wasm" with { type: "file" }
import treeSitterScalaWasm from "../../../wasm/core/pkg/grammars/tree-sitter-scala.wasm" with { type: "file" }
import treeSitterSwiftWasm from "../../../wasm/core/pkg/grammars/tree-sitter-swift.wasm" with { type: "file" }
import treeSitterTomlWasm from "../../../wasm/core/pkg/grammars/tree-sitter-toml.wasm" with { type: "file" }
import treeSitterYamlWasm from "../../../wasm/core/pkg/grammars/tree-sitter-yaml.wasm" with { type: "file" }
import chafaWasm from "../../../wasm/core/pkg/chafa.wasm" with { type: "file" }

const embeddedTreeSitterGrammarAssets = [
  ["grammars/tree-sitter-bash.wasm", treeSitterBashWasm],
  ["grammars/tree-sitter-c.wasm", treeSitterCWasm],
  ["grammars/tree-sitter-c_sharp.wasm", treeSitterCSharpWasm],
  ["grammars/tree-sitter-clojure.wasm", treeSitterClojureWasm],
  ["grammars/tree-sitter-cpp.wasm", treeSitterCppWasm],
  ["grammars/tree-sitter-css.wasm", treeSitterCssWasm],
  ["grammars/tree-sitter-go.wasm", treeSitterGoWasm],
  ["grammars/tree-sitter-haskell.wasm", treeSitterHaskellWasm],
  ["grammars/tree-sitter-hcl.wasm", treeSitterHclWasm],
  ["grammars/tree-sitter-html.wasm", treeSitterHtmlWasm],
  ["grammars/tree-sitter-java.wasm", treeSitterJavaWasm],
  ["grammars/tree-sitter-json.wasm", treeSitterJsonWasm],
  ["grammars/tree-sitter-julia.wasm", treeSitterJuliaWasm],
  ["grammars/tree-sitter-kotlin.wasm", treeSitterKotlinWasm],
  ["grammars/tree-sitter-lua.wasm", treeSitterLuaWasm],
  ["grammars/tree-sitter-nix.wasm", treeSitterNixWasm],
  ["grammars/tree-sitter-ocaml.wasm", treeSitterOcamlWasm],
  ["grammars/tree-sitter-pascal.wasm", treeSitterPascalWasm],
  ["grammars/tree-sitter-php.wasm", treeSitterPhpWasm],
  ["grammars/tree-sitter-powershell.wasm", treeSitterPowerShellWasm],
  ["grammars/tree-sitter-python.wasm", treeSitterPythonWasm],
  ["grammars/tree-sitter-ruby.wasm", treeSitterRubyWasm],
  ["grammars/tree-sitter-rust.wasm", treeSitterRustWasm],
  ["grammars/tree-sitter-scala.wasm", treeSitterScalaWasm],
  ["grammars/tree-sitter-swift.wasm", treeSitterSwiftWasm],
  ["grammars/tree-sitter-toml.wasm", treeSitterTomlWasm],
  ["grammars/tree-sitter-yaml.wasm", treeSitterYamlWasm],
] as const

export const embeddedTreeSitterGrammarAssetPaths = embeddedTreeSitterGrammarAssets.map((asset) => asset[0])

const embeddedWasmAssets = new Map([
  ["tokenizer.wasm", tokenizerWasm],
  ["diffy/diffy_wasm_bg.wasm", diffyWasm as unknown as string],
  ["json_repair/json_repair_bg.wasm", jsonRepairWasm as unknown as string],
  ["rdiff/rdiff_bg.wasm", rdiffWasm as unknown as string],
  ["tree-sitter.wasm", treeSitterRuntimeWasm],
  ["chafa.wasm", chafaWasm],
  ...embeddedTreeSitterGrammarAssets,
])

function normalizeWasmAsset(relativePath: string) {
  return relativePath.replaceAll("\\", "/").replace(/^\/+/, "")
}

export function embeddedWasmAssetPath(relativePath: string) {
  return embeddedWasmAssets.get(normalizeWasmAsset(relativePath))
}

export async function readEmbeddedWasmAsset(relativePath: string) {
  const assetPath = embeddedWasmAssetPath(relativePath)
  if (!assetPath) return { bytes: null, path: null, tried: [] as string[] }
  try {
    return { bytes: await Bun.file(assetPath).arrayBuffer(), path: assetPath, tried: [assetPath] }
  } catch (err) {
    Log.Default.warn(
      "wasm-embedded: failed to read embedded WASM asset " +
        normalizeWasmAsset(relativePath) +
        ": " +
        (err instanceof Error ? err.message : String(err)),
    )
    return { bytes: null, path: null, tried: [assetPath] }
  }
}

export * as WasmEmbedded from "./wasm-embedded"
