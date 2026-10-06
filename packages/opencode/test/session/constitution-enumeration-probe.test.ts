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
import {
  ENUMERATION_TOOLS,
  enumerationToolDecision,
  resetEnumerationToolCache,
  resolveEnumerationTool,
} from "../../src/session/enumeration-tools"
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
    for (const command of ["echo *", "echo hello"]) {
      expect(blocked(command)).toBe(false)
    }
    // `findstr` is content search: admitted only while it passes its smoke; the live verdict must equal
    // the decision, never silently differ (smoke-gate tests below).
    expect(blocked("findstr /s /i TODO *.ts")).toBe(!enumerationToolDecision("findstr").allowed)
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

// The `run` tool is binary+argv, NOT a shell (measured 2026-10-05). Its argv was reconstructed as a
// string and pushed through the legacy token path, whose shell segmentation read the CONTENTS of a
// python `-c` script as commands: the segment `for mid,role,t in out: print('='*90)` hit the
// `for`-glob rule (the `*` of a Python multiplication) and blocked a legitimate run.
describe("guardCommand argv form: argument contents are data, not shell commands", () => {
  const script = [
    "import sqlite3, json",
    "out=[]",
    "for mid,role,t in out: print('='*90); print(mid)",
  ].join("\n")
  const argvLine = `D:\\USESoft\\Python313\\python.exe -c ${script}`

  test("a python -c script with `for` and `*` is not an enumeration block", () => {
    const guard = Constitution.guardCommand(argvLine, undefined, { argv: true })
    expect(guard.blocked).toBe(false)
    expect(guard.family).toBe("ALLOWED")
  })

  test("the binary itself is still classified — git rewrite stays blocked", () => {
    const guard = Constitution.guardCommand("git checkout main", undefined, { argv: true })
    expect(guard.blocked).toBe(true)
    expect(guard.family).toBe("GIT_HISTORY_REWRITE")
  })

  test("shell form is unchanged — a real for-glob is still blocked", () => {
    expect(Constitution.guardCommand("for f in **/*; do echo $f; done").blocked).toBe(true)
  })
})

describe("smoke-gated names: findstr must actually FIND its needle", () => {
  const decision = (smoke: (name: string, path: string) => boolean) =>
    enumerationToolDecision("findstr", { exists: () => false, which: () => "C:\\fake\\findstr.exe", smoke })

  test("a resolving findstr that does not search text is BLOCKED, never read as «no matches»", () => {
    const gate = decision(() => false)
    expect(gate.allowed).toBe(false)
    expect(gate.message).toContain("smoke")
    resetEnumerationToolCache() // do not leak the injected path into the other tests
  })

  test("a findstr that passes the smoke is admitted", () => {
    expect(decision(() => true).allowed).toBe(true)
    resetEnumerationToolCache()
  })

  test("rg: content search allowed; `--files` is a blocked walk", () => {
    expect(blocked("rg TODO src")).toBe(false)
    if (resolveEnumerationTool("rg")) {
      expect(blocked("rg --files")).toBe(true)
    } else {
      // without rg on the host the name is never scanned at all
      expect(blocked("rg --files")).toBe(false)
    }
  })
})

// The enumeration gate reads the COMMAND'S HEAD only (owner, 2026-10-06): `dir` and the other
// glob/grep replacements block when they ARE the command — the searcher that walks the box — and
// not when they sit inside a `|`/`&` chain, where they are plumbing. Measured before the fix: the
// AST path blocked every node, so «dumpbin … | findstr … & dir /b one.obj» died on its own tail,
// while `dir` alone must still be refused (owner: «запрет чтобы дир не вызывался как глобальный
// искатель — потому что это вешает систему»).
describe("enumeration gate: HEAD only — a pipeline tail is plumbing, not a searcher", () => {
  const ACCEPT = `dumpbin /symbols crc32_simd64.obj 2>&1 | findstr /i "UNDEF" & echo --- & dir /b crc32_simd64.obj`

  test("the owner's acceptance pipeline runs in the token path", () => {
    expect(blocked(ACCEPT)).toBe(false)
  })

  test("the same word AS the command is still the searcher, and still blocked", () => {
    expect(blocked("dir")).toBe(true)
    expect(blocked("dir /b")).toBe(true)
    expect(blocked("dir /s /b *.obj")).toBe(true)
  })

  test("the AST path agrees: only the head node may block as an enumerator", async () => {
    const parser = await getParser()
    for (const grammar of [
      { name: "ps", engine: parser.ps, isCmd: false },
      { name: "cmd", engine: parser.cmd, isCmd: true },
    ] as const) {
      const root = parseShell(grammar.engine, ACCEPT, grammar.isCmd)?.rootNode
      expect(root).toBeTruthy()
      const tail = Constitution.evaluate(root!, grammar.isCmd).blocked.filter((f) => f.isFileEnumerator)
      // On failure the array prints the offending command — the tail must contribute NO block.
      expect(tail.map((f) => `${grammar.name}: ${f.command}`)).toEqual([])

      // Control on the SAME instrument: the head alone is still refused.
      const headRoot = parseShell(grammar.engine, "dir /b", grammar.isCmd)?.rootNode
      expect(headRoot).toBeTruthy()
      expect(Constitution.evaluate(headRoot!, grammar.isCmd).blocked.some((f) => f.isFileEnumerator)).toBe(true)
    }
  })
})
