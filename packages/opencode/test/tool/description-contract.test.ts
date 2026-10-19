import { describe, expect, setDefaultTimeout, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

// t94 T0: generic description contract for every tool.
// - every .txt has a loader (same-named .ts, or the mapped loader for the four renamed files)
// - every [key] in code appears in doc and vice versa (for tools that use keys)
// - no NEW un-keyed throw beyond the allowlist (per-tool tasks shrink it to zero)
// - every ```json example in the .txt parses as JSON (schema validation lands per-tool)

setDefaultTimeout(30_000)

const TOOL_DIR = path.join(__dirname, "..", "..", "src", "tool")

// Four .txt files without a same-named .ts: each is loaded under another name (grep 2026-10-19).
// If a fifth appears, it is an orphan until its loader is named here.
const RENAMED_LOADERS: Record<string, string> = {
  "plan-enter.txt": "plan.ts",
  "planexit.txt": "plan.ts",
  "powershell.txt": "bash.ts",
  "todowrite.txt": "todo.ts",
}

function extractKeys(text: string): Set<string> {
  const out = new Set<string>()
  // Refusal keys are lowercase by convention ([same-file], [not-hex]); epistemic markers
  // ([Exact], [Inferred]) are uppercase and must not count as keys — t94 RED 2026-10-19 on aicall.txt.
  const re = /["'`]\[([a-z][A-Za-z0-9_+-]{2,})\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.add(`[${m[1]}]`)
  return out
}

function extractCodeKeys(ts: string): Set<string> {
  // Whole-file scan MINUS output labels. Refusals collected via refusals.push / returned
  // strings (edit.ts resolveAddresses) never touch `throw`, so a throw-only scan misses 13/20
  // edit keys (t94 RED 2026-10-19). Output labels (`[reasoning]` in sessionread.ts, `[text]`/`[tool]`
  // in comments) share the bracket spelling but are not refusals — denylisted, not counted.
  // [summary] is the sessionread output label (sessionread.ts:154), same class as [reasoning].
  const DENY = new Set(["[text]", "[tool]", "[reasoning]", "[summary]"])
  const out = new Set<string>()
  for (const k of extractKeys(ts)) if (!DENY.has(k)) out.add(k)
  return out
}

function unkeyedThrows(ts: string): string[] {
  // A refusal is a `throw new Error("` / `throw new Error(` literal whose string does NOT start
  // with a [key]. Template throws that interpolate a pre-keyed refusal (join("\n")) are keyed
  // by construction and are skipped here.
  const out: string[] = []
  const lines = ts.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.includes("throw new Error(")) continue
    if (line.includes("refusals.join")) continue
    if (line.includes("resolution.refusals")) continue
    // Same-line keyed throw: throw new Error("[key] ...
    if (/throw new Error\(\s*[`"'|]\[[a-z]/.test(line)) continue
    // Multi-line keyed throw: next non-empty line starts with "[key]"
    let j = i + 1
    while (j < lines.length && lines[j]!.trim() === "") j++
    const next = (lines[j] ?? "").trim()
    if (/^[`"'|]\[[a-z]/.test(next)) continue
    out.push(`line ${i + 1}: ${line.trim().slice(0, 160)}`)
  }
  return out
}

function extractJsonBlocks(txt: string): { block: string; index: number }[] {
  const out: { block: string; index: number }[] = []
  const re = /```json\s*([\s\S]*?)```/g
  let m: RegExpExecArray | null
  let index = 0
  while ((m = re.exec(txt)) !== null) out.push({ block: m[1]!, index: index++ })
  return out
}

function extractDocKeys(doc: string): Set<string> {
  // Refusal keys live in the doc's Refusals table (`| \`[key]\` | ... |`). Part-type labels
  // (`[text]`, `[tool]`), epistemic markers ([Exact]) and prose brackets must not count —
  // t94 RED 2026-10-19 on messagesearch.txt (`[text]`, `[tool]`, `[reasoning]` are output labels).
  const out = new Set<string>()
  const re = /[`\"']\[([a-z][A-Za-z0-9_+-]{2,})\]/g
  for (const line of doc.split("\n")) {
    if (!line.includes("|")) continue
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(line)) !== null) out.add(`[${m[1]}]`)
  }
  return out
}

// Current un-keyed-throw debt (t94 census 2026-10-19). Per-tool tasks remove their entry
// when they key the throws AND document each key. An entry removed too early fails
// (fewer un-keyed than listed); a new bare throw fails (more than listed).
const UNKEYED_ALLOWLIST: Record<string, number> = {
  "grep.ts": 1,
  "tool.ts": 2,
  "universalsearch.ts": 17,
  "fossilgrep.ts": 2,
  "bash.ts": 3,
  "cmd.ts": 3,
  "read.ts": 2,
  "cua.ts": 16,
  "samply.ts": 2,
  "shell-constitution.ts": 3,
  "run.ts": 1,
  "webfetch.ts": 3,
  "view.ts": 3,
  "treediff.ts": 1,
  "skill.ts": 1,
  "pattern.ts": 2,
  "lsp.ts": 2,
  "json-schema.ts": 1,
}

describe("t94 description contract — every tool", () => {
  test("every .txt has a loader", async () => {
    const entries = await fs.readdir(TOOL_DIR)
    const txts = entries.filter((e) => e.endsWith(".txt")).sort()
    expect(txts.length).toBeGreaterThan(0)
    for (const txt of txts) {
      const sameTs = txt.replace(/\.txt$/, ".ts")
      if (entries.includes(sameTs)) continue
      const loader = RENAMED_LOADERS[txt]
      expect(loader, `${txt} has no same-named .ts and no mapped loader — orphan or missing mapping`).toBeDefined()
      expect(entries, `${txt} maps to ${loader} which is not in the tool dir`).toContain(loader!)
      const loaderSrc = await fs.readFile(path.join(TOOL_DIR, loader!), "utf8")
      const stem = txt.replace(/\.txt$/, "")
      expect(loaderSrc, `${loader} does not load ${txt}`).toContain(stem)
    }
  })

  test("refusal keys in code appear in doc and vice versa", async () => {
    const entries = await fs.readdir(TOOL_DIR)
    const txts = entries.filter((e) => e.endsWith(".txt")).sort()
    for (const txt of txts) {
      const tsName = entries.includes(txt.replace(/\.txt$/, ".ts")) ? txt.replace(/\.txt$/, ".ts") : RENAMED_LOADERS[txt]!
      const ts = await fs.readFile(path.join(TOOL_DIR, tsName), "utf8")
      const doc = await fs.readFile(path.join(TOOL_DIR, txt), "utf8")
      const tsKeys = [...extractCodeKeys(ts)].sort()
      const docKeys = [...extractDocKeys(doc)].sort()
      // Tools without keys pass vacuously — but both sides must agree, so a doc key
      // without code (FICTION) or a code key without doc (SILENCE) fails.
      expect(docKeys, `${txt} keys != ${tsName} keys (code [${tsKeys.join(", ")}] vs doc [${docKeys.join(", ")}])`).toEqual(tsKeys)
    }
  })

  test("no new un-keyed throw beyond the allowlist", async () => {
    const entries = await fs.readdir(TOOL_DIR)
    const tsFiles = entries.filter((e) => e.endsWith(".ts")).sort()
    const seen: Record<string, number> = {}
    const details: string[] = []
    for (const tsName of tsFiles) {
      const src = await fs.readFile(path.join(TOOL_DIR, tsName), "utf8")
      const bad = unkeyedThrows(src)
      if (bad.length > 0) {
        seen[tsName] = bad.length
        for (const b of bad) details.push(`${tsName} ${b}`)
      }
    }
    expect(
      seen,
      `un-keyed throws changed (allowlist ${JSON.stringify(UNKEYED_ALLOWLIST)} vs seen ${JSON.stringify(seen)}):\n${details.join("\n")}`,
    ).toEqual(UNKEYED_ALLOWLIST)
  })

  test("every ```json example in every .txt parses as JSON", async () => {
    const entries = await fs.readdir(TOOL_DIR)
    const txts = entries.filter((e) => e.endsWith(".txt")).sort()
    for (const txt of txts) {
      const doc = await fs.readFile(path.join(TOOL_DIR, txt), "utf8")
      for (const { block, index } of extractJsonBlocks(doc)) {
        // A block may hold one JSON value (edit.txt) or one example per line (run.txt: three
        // separate calls). Try the whole block first; on failure, every non-empty line must parse alone.
        let parsed: unknown = undefined
        try {
          parsed = JSON.parse(block)
        } catch {
          const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
          try {
            for (const line of lines) JSON.parse(line)
            parsed = lines
          } catch (e) {
            throw new Error(`${txt} json block #${index} does not parse: ${String(e).slice(0, 200)}`)
          }
        }
      }
    }
  })
})
