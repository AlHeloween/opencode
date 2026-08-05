/**
 * Pre-write syntax validation for code files.
 *
 * When the model generates code via the write tool, the JSON structure is valid
 * but the content inside can contain hallucinated syntax errors (fused variable
 * names, broken strings, etc.) that produce garbage files on disk.
 *
 * Validate BEFORE writing — model gets a clear error with line:col and can retry.
 */
import { readWasmAsset } from "./wasm-path"

const extToGrammar: Record<string, string> = {
  ".py": "grammars/tree-sitter-python.wasm",
  ".ts": "grammars/tree-sitter-typescript.wasm",
  ".tsx": "grammars/tree-sitter-tsx.wasm",
  ".js": "grammars/tree-sitter-javascript.wasm",
  ".jsx": "grammars/tree-sitter-tsx.wasm",
  ".sh": "grammars/tree-sitter-bash.wasm",
  ".bash": "grammars/tree-sitter-bash.wasm",
}

const parserCache = new Map<string, Promise<import("web-tree-sitter").Parser>>()

function getParser(grammar: string): Promise<import("web-tree-sitter").Parser> {
  let p = parserCache.get(grammar)
  if (!p) {
    p = (async () => {
      const [{ Parser }, { Language }, grammarWasm, runtimeWasm] = await Promise.all([
        import("web-tree-sitter"),
        import("web-tree-sitter"),
        readWasmAsset(grammar),
        readWasmAsset("web-tree-sitter.wasm"),
      ])
      if (!grammarWasm.bytes || !runtimeWasm.bytes) throw new Error(`tree-sitter grammar unavailable: ${grammar}`)
      await (Parser.init as any)({ wasmBinary: runtimeWasm.bytes })
      const language = await Language.load(new Uint8Array(grammarWasm.bytes))
      const parser = new Parser()
      parser.setLanguage(language)
      return parser
    })()
    parserCache.set(grammar, p)
  }
  return p
}

export interface SyntaxValidationError {
  line: number
  col: number
  message: string
}

/**
 * Validate code syntax before writing to disk.
 * Returns null if content is clean or extension is not handled.
 * Returns a SyntaxValidationError with line:col if broken.
 */
export async function validateCodeSyntax(
  filePath: string,
  content: string,
): Promise<SyntaxValidationError | null> {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
  const grammar = extToGrammar[ext]
  if (!grammar) return null // unhandled extension — skip validation

  let parser: import("web-tree-sitter").Parser
  try {
    parser = await getParser(grammar)
  } catch {
    return null // grammar unavailable — skip gracefully
  }

  const tree = parser.parse(content)
  if (!tree) return null

  const errors = tree.rootNode.descendantsOfType("ERROR")
  if (errors.length === 0) return null

  const first = errors[0]!
  const beforeError = content.slice(0, first.startIndex)
  const lines = beforeError.split("\n")
  const line = lines.length
  const col = (lines[lines.length - 1]?.length ?? 0) + 1
  const snippet = content.slice(
    first.startIndex,
    Math.min(content.length, first.endIndex + 40),
  )

  return {
    line,
    col,
    message:
      `Syntax error at line ${line}, column ${col}: unexpected "${snippet.slice(0, 50)}"` +
      (snippet.length > 50 ? "..." : "") +
      `. Fix the code and call write again.`,
  }
}
