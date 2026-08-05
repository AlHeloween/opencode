/**
 * Shared TreeSitter parser initialization.
 *
 * Both bash.ts and cmd.ts independently loaded the same 3 grammars
 * (bash, batch, PowerShell).  This module provides a single lazy
 * initialization point so:
 * 1. WASM is loaded once
 * 2. The constitution can use TreeSitter AST for command classification
 *    instead of fragile regex on raw command strings.
 */
import { lazy } from "@/util/lazy"
import { readWasmAsset } from "@/util/wasm-path"
import { Language, Parser, type Node } from "web-tree-sitter"

export type ShellParsers = {
  bash: Parser
  cmd: Parser
  ps: Parser
}

/** Shared lazy parser — loaded once, shared by bash-tool, cmd-tool, and constitution. */
export const getParser: () => Promise<ShellParsers> = lazy(async () => {
  const treeWasm = await readWasmAsset("web-tree-sitter.wasm")
  if (!treeWasm.bytes) {
    throw new Error("tree-sitter runtime WASM unavailable; tried: " + JSON.stringify(treeWasm.tried))
  }
  // web-tree-sitter types require full EmscriptenModule, but runtime accepts wasmBinary.
  await (Parser.init as any)({
    wasmBinary: treeWasm.bytes,
  })
  const [bashWasm, cmdWasm, psWasm] = await Promise.all([
    readWasmAsset("grammars/tree-sitter-bash.wasm"),
    readWasmAsset("grammars/tree-sitter-batch.wasm"),
    readWasmAsset("grammars/tree-sitter-powershell.wasm"),
  ])
  if (!bashWasm.bytes) throw new Error("bash grammar WASM unavailable; tried: " + JSON.stringify(bashWasm.tried))
  if (!cmdWasm.bytes) throw new Error("batch grammar WASM unavailable; tried: " + JSON.stringify(cmdWasm.tried))
  if (!psWasm.bytes) throw new Error("PowerShell grammar WASM unavailable; tried: " + JSON.stringify(psWasm.tried))

  const [bashLanguage, cmdLanguage, psLanguage] = await Promise.all([
    Language.load(new Uint8Array(bashWasm.bytes)),
    Language.load(new Uint8Array(cmdWasm.bytes)),
    Language.load(new Uint8Array(psWasm.bytes)),
  ])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const cmd = new Parser()
  cmd.setLanguage(cmdLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, cmd, ps }
})

// ============================================================================
// AST helpers — shared between bash.ts, cmd.ts, and constitution
// ============================================================================

export type AstPart = {
  type: string
  text: string
}

/**
 * Extract command parts from a TreeSitter node.
 *
 * For bash/PowerShell grammar: extracts command_name + words/strings.
 * For batch (cmd.exe) grammar: extracts command_name + argument_list items.
 */
export function parts(node: Node, isCmd: boolean): AstPart[] {
  if (isCmd) {
    const out: AstPart[] = []
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.type === "command_name") {
        out.push({ type: child.type, text: child.text })
        continue
      }
      if (child.type !== "argument_list") continue
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "line_continuation") continue
        if (
          item.type === "command_option" ||
          item.type === "argument_value" ||
          item.type === "string"
        ) {
          out.push({ type: item.type, text: item.text })
          continue
        }
        out.push({ type: item.type, text: item.text })
      }
    }
    return out
  }

  // Bash / PowerShell grammar AST traversal
  const out: AstPart[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        out.push({ type: item.type, text: item.text })
      }
      continue
    }
    if (
      child.type !== "command_name" &&
      child.type !== "command_name_expr" &&
      child.type !== "word" &&
      child.type !== "string" &&
      child.type !== "raw_string" &&
      child.type !== "concatenation" &&
      child.type !== "generic_token" &&
      child.type !== "array_literal_expression"
    ) {
      continue
    }
    out.push({ type: child.type, text: child.text })
  }
  return out
}

/** Get all command nodes from a parsed tree. */
export function commands(node: Node, isCmd: boolean): Node[] {
  return node
    .descendantsOfType(isCmd ? "cmd" : "command")
    .filter((child): child is Node => Boolean(child))
}

/** Get the source text of a command from its node. */
export function source(node: Node, isCmd: boolean): string {
  if (isCmd) {
    return (node.parent?.type === "redirect_stmt" ? node.parent.text : node.text).trim()
  }
  return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

/** Check if a command node has shell redirections. */
export function hasRedirection(node: Node, isCmd: boolean): boolean {
  if (isCmd) {
    return (
      node.descendantsOfType("redirection").length > 0 ||
      node.parent?.type === "redirect_stmt"
    )
  }
  return node.descendantsOfType("redirection").length > 0
}

/** Strip quotes from a token. */
export function unquote(text: string): string {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && first === last) return text.slice(1, -1)
  return text
}
