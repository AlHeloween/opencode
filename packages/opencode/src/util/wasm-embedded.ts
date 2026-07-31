import * as Log from "@opencode-ai/core/util/log"

// tokenizer.wasm intentionally omitted — content tokens use chars/4 (no WASM BPE).
import pathValidatorWasm from "../../../wasm/core/pkg/path_validator.wasm" with { type: "file" }
import diffyWasm from "../../../wasm/core/pkg/diffy/diffy_wasm_bg.wasm" with { type: "file" }
import jsonRepairWasm from "../../../wasm/core/pkg/json_repair/json_repair_bg.wasm" with { type: "file" }
import anyrepairWasm from "../../../wasm/core/pkg/anyrepair/anyrepair_wasm_bg.wasm" with { type: "file" }
import rdiffWasm from "../../../wasm/core/pkg/rdiff/rdiff_bg.wasm" with { type: "file" }
import markdownifyWasm from "../../../wasm/markdownify/pkg/markdownify_wasm_bg.wasm" with { type: "file" }
import chafaWasm from "../../../wasm/core/pkg/chafa.wasm" with { type: "file" }
import treeSitterRuntimeWasm from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" }
import mermaidRendererWasm from "mermaid-wasm-renderer/mermaid_wasm_renderer_bg.wasm" with { type: "file" }

// Tree-sitter grammar WASMs — all bundled from packages/wasm/core/pkg/grammars/
import treeSitterArktsWasm from "../../../wasm/core/pkg/grammars/tree-sitter-arkts.wasm" with { type: "file" }
import treeSitterBashWasm from "../../../wasm/core/pkg/grammars/tree-sitter-bash.wasm" with { type: "file" }
import treeSitterBatchWasm from "../../../wasm/core/pkg/grammars/tree-sitter-batch.wasm" with { type: "file" }
import treeSitterCWasm from "../../../wasm/core/pkg/grammars/tree-sitter-c.wasm" with { type: "file" }
import treeSitterCfmlWasm from "../../../wasm/core/pkg/grammars/tree-sitter-cfml.wasm" with { type: "file" }
import treeSitterCfqueryWasm from "../../../wasm/core/pkg/grammars/tree-sitter-cfquery.wasm" with { type: "file" }
import treeSitterCfscriptWasm from "../../../wasm/core/pkg/grammars/tree-sitter-cfscript.wasm" with { type: "file" }
import treeSitterClojureWasm from "../../../wasm/core/pkg/grammars/tree-sitter-clojure.wasm" with { type: "file" }
import treeSitterCobolWasm from "../../../wasm/core/pkg/grammars/tree-sitter-cobol.wasm" with { type: "file" }
import treeSitterCppWasm from "../../../wasm/core/pkg/grammars/tree-sitter-cpp.wasm" with { type: "file" }
import treeSitterCSharpWasm from "../../../wasm/core/pkg/grammars/tree-sitter-c_sharp.wasm" with { type: "file" }
import treeSitterCssWasm from "../../../wasm/core/pkg/grammars/tree-sitter-css.wasm" with { type: "file" }
import treeSitterDartWasm from "../../../wasm/core/pkg/grammars/tree-sitter-dart.wasm" with { type: "file" }
import treeSitterElispWasm from "../../../wasm/core/pkg/grammars/tree-sitter-elisp.wasm" with { type: "file" }
import treeSitterElixirWasm from "../../../wasm/core/pkg/grammars/tree-sitter-elixir.wasm" with { type: "file" }
import treeSitterElmWasm from "../../../wasm/core/pkg/grammars/tree-sitter-elm.wasm" with { type: "file" }
import treeSitterEmbeddedTemplateWasm from "../../../wasm/core/pkg/grammars/tree-sitter-embedded_template.wasm" with { type: "file" }
import treeSitterErlangWasm from "../../../wasm/core/pkg/grammars/tree-sitter-erlang.wasm" with { type: "file" }
import treeSitterGoWasm from "../../../wasm/core/pkg/grammars/tree-sitter-go.wasm" with { type: "file" }
import treeSitterHaskellWasm from "../../../wasm/core/pkg/grammars/tree-sitter-haskell.wasm" with { type: "file" }
import treeSitterHclWasm from "../../../wasm/core/pkg/grammars/tree-sitter-hcl.wasm" with { type: "file" }
import treeSitterHtmlWasm from "../../../wasm/core/pkg/grammars/tree-sitter-html.wasm" with { type: "file" }
import treeSitterJavaWasm from "../../../wasm/core/pkg/grammars/tree-sitter-java.wasm" with { type: "file" }
import treeSitterJavascriptWasm from "../../../wasm/core/pkg/grammars/tree-sitter-javascript.wasm" with { type: "file" }
import treeSitterJsonWasm from "../../../wasm/core/pkg/grammars/tree-sitter-json.wasm" with { type: "file" }
import treeSitterJuliaWasm from "../../../wasm/core/pkg/grammars/tree-sitter-julia.wasm" with { type: "file" }
import treeSitterKotlinWasm from "../../../wasm/core/pkg/grammars/tree-sitter-kotlin.wasm" with { type: "file" }
import treeSitterLuaWasm from "../../../wasm/core/pkg/grammars/tree-sitter-lua.wasm" with { type: "file" }
import treeSitterLuauWasm from "../../../wasm/core/pkg/grammars/tree-sitter-luau.wasm" with { type: "file" }
import treeSitterMarkdownWasm from "../../../wasm/core/pkg/grammars/tree-sitter-markdown.wasm" with { type: "file" }
import treeSitterMarkdownInlineWasm from "../../../wasm/core/pkg/grammars/tree-sitter-markdown_inline.wasm" with { type: "file" }
import treeSitterNixWasm from "../../../wasm/core/pkg/grammars/tree-sitter-nix.wasm" with { type: "file" }
import treeSitterObjcWasm from "../../../wasm/core/pkg/grammars/tree-sitter-objc.wasm" with { type: "file" }
import treeSitterOcamlWasm from "../../../wasm/core/pkg/grammars/tree-sitter-ocaml.wasm" with { type: "file" }
import treeSitterPascalWasm from "../../../wasm/core/pkg/grammars/tree-sitter-pascal.wasm" with { type: "file" }
import treeSitterPhpWasm from "../../../wasm/core/pkg/grammars/tree-sitter-php.wasm" with { type: "file" }
import treeSitterPowerShellWasm from "../../../wasm/core/pkg/grammars/tree-sitter-powershell.wasm" with { type: "file" }
import treeSitterPythonWasm from "../../../wasm/core/pkg/grammars/tree-sitter-python.wasm" with { type: "file" }
import treeSitterQlWasm from "../../../wasm/core/pkg/grammars/tree-sitter-ql.wasm" with { type: "file" }
import treeSitterRWasm from "../../../wasm/core/pkg/grammars/tree-sitter-r.wasm" with { type: "file" }
import treeSitterRescriptWasm from "../../../wasm/core/pkg/grammars/tree-sitter-rescript.wasm" with { type: "file" }
import treeSitterRubyWasm from "../../../wasm/core/pkg/grammars/tree-sitter-ruby.wasm" with { type: "file" }
import treeSitterRustWasm from "../../../wasm/core/pkg/grammars/tree-sitter-rust.wasm" with { type: "file" }
import treeSitterScalaWasm from "../../../wasm/core/pkg/grammars/tree-sitter-scala.wasm" with { type: "file" }
import treeSitterSolidityWasm from "../../../wasm/core/pkg/grammars/tree-sitter-solidity.wasm" with { type: "file" }
import treeSitterSwiftWasm from "../../../wasm/core/pkg/grammars/tree-sitter-swift.wasm" with { type: "file" }
import treeSitterSystemrdlWasm from "../../../wasm/core/pkg/grammars/tree-sitter-systemrdl.wasm" with { type: "file" }
import treeSitterTerraformWasm from "../../../wasm/core/pkg/grammars/tree-sitter-terraform.wasm" with { type: "file" }
import treeSitterTlaplusWasm from "../../../wasm/core/pkg/grammars/tree-sitter-tlaplus.wasm" with { type: "file" }
import treeSitterTomlWasm from "../../../wasm/core/pkg/grammars/tree-sitter-toml.wasm" with { type: "file" }
import treeSitterTsxWasm from "../../../wasm/core/pkg/grammars/tree-sitter-tsx.wasm" with { type: "file" }
import treeSitterTypescriptWasm from "../../../wasm/core/pkg/grammars/tree-sitter-typescript.wasm" with { type: "file" }
import treeSitterVbnetWasm from "../../../wasm/core/pkg/grammars/tree-sitter-vbnet.wasm" with { type: "file" }
import treeSitterVhdlWasm from "../../../wasm/core/pkg/grammars/tree-sitter-vhdl.wasm" with { type: "file" }
import treeSitterVueWasm from "../../../wasm/core/pkg/grammars/tree-sitter-vue.wasm" with { type: "file" }
import treeSitterYamlWasm from "../../../wasm/core/pkg/grammars/tree-sitter-yaml.wasm" with { type: "file" }
import treeSitterZigWasm from "../../../wasm/core/pkg/grammars/tree-sitter-zig.wasm" with { type: "file" }

const embeddedTreeSitterGrammarAssets = [
  ["grammars/tree-sitter-arkts.wasm", treeSitterArktsWasm],
  ["grammars/tree-sitter-bash.wasm", treeSitterBashWasm],
  ["grammars/tree-sitter-batch.wasm", treeSitterBatchWasm],
  ["grammars/tree-sitter-c.wasm", treeSitterCWasm],
  ["grammars/tree-sitter-cfml.wasm", treeSitterCfmlWasm],
  ["grammars/tree-sitter-cfquery.wasm", treeSitterCfqueryWasm],
  ["grammars/tree-sitter-cfscript.wasm", treeSitterCfscriptWasm],
  ["grammars/tree-sitter-clojure.wasm", treeSitterClojureWasm],
  ["grammars/tree-sitter-cobol.wasm", treeSitterCobolWasm],
  ["grammars/tree-sitter-cpp.wasm", treeSitterCppWasm],
  ["grammars/tree-sitter-c_sharp.wasm", treeSitterCSharpWasm],
  ["grammars/tree-sitter-css.wasm", treeSitterCssWasm],
  ["grammars/tree-sitter-dart.wasm", treeSitterDartWasm],
  ["grammars/tree-sitter-elisp.wasm", treeSitterElispWasm],
  ["grammars/tree-sitter-elixir.wasm", treeSitterElixirWasm],
  ["grammars/tree-sitter-elm.wasm", treeSitterElmWasm],
  ["grammars/tree-sitter-embedded_template.wasm", treeSitterEmbeddedTemplateWasm],
  ["grammars/tree-sitter-erlang.wasm", treeSitterErlangWasm],
  ["grammars/tree-sitter-go.wasm", treeSitterGoWasm],
  ["grammars/tree-sitter-haskell.wasm", treeSitterHaskellWasm],
  ["grammars/tree-sitter-hcl.wasm", treeSitterHclWasm],
  ["grammars/tree-sitter-html.wasm", treeSitterHtmlWasm],
  ["grammars/tree-sitter-java.wasm", treeSitterJavaWasm],
  ["grammars/tree-sitter-javascript.wasm", treeSitterJavascriptWasm],
  ["grammars/tree-sitter-json.wasm", treeSitterJsonWasm],
  ["grammars/tree-sitter-julia.wasm", treeSitterJuliaWasm],
  ["grammars/tree-sitter-kotlin.wasm", treeSitterKotlinWasm],
  ["grammars/tree-sitter-lua.wasm", treeSitterLuaWasm],
  ["grammars/tree-sitter-luau.wasm", treeSitterLuauWasm],
  ["grammars/tree-sitter-markdown.wasm", treeSitterMarkdownWasm],
  ["grammars/tree-sitter-markdown_inline.wasm", treeSitterMarkdownInlineWasm],
  ["grammars/tree-sitter-nix.wasm", treeSitterNixWasm],
  ["grammars/tree-sitter-objc.wasm", treeSitterObjcWasm],
  ["grammars/tree-sitter-ocaml.wasm", treeSitterOcamlWasm],
  ["grammars/tree-sitter-pascal.wasm", treeSitterPascalWasm],
  ["grammars/tree-sitter-php.wasm", treeSitterPhpWasm],
  ["grammars/tree-sitter-powershell.wasm", treeSitterPowerShellWasm],
  ["grammars/tree-sitter-python.wasm", treeSitterPythonWasm],
  ["grammars/tree-sitter-ql.wasm", treeSitterQlWasm],
  ["grammars/tree-sitter-r.wasm", treeSitterRWasm],
  ["grammars/tree-sitter-rescript.wasm", treeSitterRescriptWasm],
  ["grammars/tree-sitter-ruby.wasm", treeSitterRubyWasm],
  ["grammars/tree-sitter-rust.wasm", treeSitterRustWasm],
  ["grammars/tree-sitter-scala.wasm", treeSitterScalaWasm],
  ["grammars/tree-sitter-solidity.wasm", treeSitterSolidityWasm],
  ["grammars/tree-sitter-swift.wasm", treeSitterSwiftWasm],
  ["grammars/tree-sitter-systemrdl.wasm", treeSitterSystemrdlWasm],
  ["grammars/tree-sitter-terraform.wasm", treeSitterTerraformWasm],
  ["grammars/tree-sitter-tlaplus.wasm", treeSitterTlaplusWasm],
  ["grammars/tree-sitter-toml.wasm", treeSitterTomlWasm],
  ["grammars/tree-sitter-tsx.wasm", treeSitterTsxWasm],
  ["grammars/tree-sitter-typescript.wasm", treeSitterTypescriptWasm],
  ["grammars/tree-sitter-vbnet.wasm", treeSitterVbnetWasm],
  ["grammars/tree-sitter-vhdl.wasm", treeSitterVhdlWasm],
  ["grammars/tree-sitter-vue.wasm", treeSitterVueWasm],
  ["grammars/tree-sitter-yaml.wasm", treeSitterYamlWasm],
  ["grammars/tree-sitter-zig.wasm", treeSitterZigWasm],
] as const

export const embeddedTreeSitterGrammarAssetPaths = embeddedTreeSitterGrammarAssets.map((asset) => asset[0])

const embeddedWasmAssets = new Map([
  ["path_validator.wasm", pathValidatorWasm as unknown as string],
  ["diffy/diffy_wasm_bg.wasm", diffyWasm as unknown as string],
  ["json_repair/json_repair_bg.wasm", jsonRepairWasm as unknown as string],
  ["anyrepair/anyrepair_wasm_bg.wasm", anyrepairWasm as unknown as string],
  ["rdiff/rdiff_bg.wasm", rdiffWasm as unknown as string],
  ["markdownify/markdownify_wasm_bg.wasm", markdownifyWasm as unknown as string],
  ["chafa.wasm", chafaWasm as unknown as string],
  ["web-tree-sitter.wasm", treeSitterRuntimeWasm],
  ["mermaid/mermaid_wasm_renderer_bg.wasm", mermaidRendererWasm as unknown as string],
  ...embeddedTreeSitterGrammarAssets,
])

/** All registry keys (for packaging / health). No tokenizer.wasm — unused. */
export const embeddedWasmAssetPaths = [...embeddedWasmAssets.keys()]

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
