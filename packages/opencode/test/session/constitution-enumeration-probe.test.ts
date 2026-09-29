/**
 * The enumeration guard is PLATFORM-AWARE BY DESIGN — pinned here, because the older cross-platform
 * assertions in `constitution.test.ts` called `find` a blocker everywhere and went red once the
 * narrowing landed.
 *
 * `session/constitution.ts:63-73`: `find` is an AMBIGUOUS name — System32's `find.exe` is a TEXT SEARCH
 * on Windows, not a directory walker — so it enters the guarded set only where a real unix build can
 * sit (beside the binary, or in the worktree's `tools/`). The comment there records the measurement
 * that forced the narrowing: `find /c "??"` — grep-shaped — was refused as directory enumeration.
 *
 * `tree`, by contrast, IS an enumerator on both platforms (`:42` on win32, `:46` on POSIX), so it must
 * stay blocked. The positive control below is what keeps an "everything is allowed" regression from
 * reading as a pass.
 */
import { describe, expect, test } from "bun:test"
import { Constitution } from "../../src/session/constitution"
import { ENUMERATION_TOOLS } from "../../src/session/enumeration-tools"
import { getParser, parseShell } from "../../src/shell/tree-sitter"

const isWin = process.platform === "win32"
const blocked = (command: string) => Constitution.guardCommand(command).blocked

describe("enumeration guard: platform-aware, and still armed", () => {
  test("POSITIVE CONTROL — a real enumerator on THIS platform is blocked", () => {
    expect(blocked(isWin ? "Get-ChildItem -Force" : "ls -la")).toBe(true)
  })

  test("`tree` stays blocked wherever it is a real enumerator", () => {
    expect(blocked("tree")).toBe(true)
    if (isWin) expect(blocked("tree /f")).toBe(true)
  })

  test("`find` is blocked only where a unix build exists — never as System32's text search", () => {
    if (isWin) {
      // Blocking this refused a working grep-shaped command; `find.exe` here searches FILES' text.
      expect(blocked('find /c "TODO" file.txt')).toBe(false)
    } else {
      expect(blocked("find . -type f")).toBe(true)
    }
  })

  test("stdout printing and content search stay allowed", () => {
    for (const command of ["echo *", "echo hello", "findstr /s /i TODO *.ts"]) {
      expect(blocked(command)).toBe(false)
    }
  })
})

// C9 (plans/2026-09-29_bash-tool-single-execution-path.md): the AST path and the token path are ONE
// predicate. `evaluate` used to block every enumerator while `guardCommand` let a resolved unix tool
// through, and the AST block's message was rebuilt as "" for any tool that resolves.
describe("enumeration guard: the AST path agrees with the token path", () => {
  const commands = [...ENUMERATION_TOOLS.map((name) => `${name} x`), "dir", "tree /f", "Get-ChildItem -Force"]

  test("same verdict, and every AST block names its reason", async () => {
    const parser = await getParser()
    const grammars = [
      { isCmd: false, engine: isWin ? parser.ps : parser.bash },
      ...(isWin ? [{ isCmd: true, engine: parser.cmd }] : []),
    ]
    for (const grammar of grammars) {
      for (const command of commands) {
        const root = parseShell(grammar.engine, command, grammar.isCmd)?.rootNode
        expect(root).toBeTruthy()
        const ast = Constitution.evaluate(root!, grammar.isCmd).blocked.filter((f) => f.isFileEnumerator)
        expect({ command, isCmd: grammar.isCmd, blocked: ast.length > 0 }).toEqual({
          command,
          isCmd: grammar.isCmd,
          blocked: blocked(command),
        })
        for (const finding of ast) expect(finding.message ?? "").toContain("BLOCKED")
      }
    }
  })
})
