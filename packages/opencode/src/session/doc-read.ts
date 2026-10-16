/**
 * Docs-are-read gate — the second half of the owner's 2026-10-15 finding: «у ребят привычка
 * анализировать доки питоном без вчитывания это надо пресекать».
 *
 * A bash/cmd command that runs python/node and reads the TEXT of a document (`.md`, `.txt`,
 * `.rst`) — `read_text()`, `open(...)` in text mode, `fs.readFileSync(..., 'utf8')` — is refused
 * with the route to the `read` tool. Byte-level checks stay allowed: `read_bytes`, `'rb'`,
 * `readFileSync` without an encoding return bytes, not text, and encoding/BOM/CRLF work is
 * legitimate. Doc WRITES are out of scope here (AGENTS.md routes writes through edit/write) —
 * they pass this gate.
 *
 * A text heuristic by design (the measured cases are inline `-c` scripts); a script FILE that
 * reads docs internally is invisible to it — a named residual, not a promise.
 *
 * [KV-CACHE SAFE] — runtime gate on shell execution; never touches prompts.
 */
import { configValue } from "@opencode-ai/core/flag/flag"

/** Opt-out switch: OPENCODE_DOC_READ_GATE=0|false|off|no (the repo's convention — stop-check.ts). */
export const OPT_OUT_ENV = "OPENCODE_DOC_READ_GATE"

const INTERPRETER = /\b(?:python|python3|node)(?:\.exe)?\b/i
const DOC_EXT = /\.(?:md|txt|rst)\b/i
/** Python text reads: read_text/readlines/.read() and open( — text mode is python's default. */
const PY_TEXT_READ = /read_text\s*\(|readlines\s*\(|\.read\s*\(|\bopen\s*\(/
/** Node text reads: only an explicit encoding makes readFileSync/readFile a TEXT read. */
const NODE_TEXT_READ = /read(?:File|FileSync)\s*\([^)]*['"]utf-?8['"]/i
/**
 * Byte reads and doc writes stay allowed: read_bytes, 'rb'/'br' modes, readFileSync without an
 * encoding, open(...,'w'|'a'|'x'), write_text/write_bytes.
 */
const BYTE_OR_WRITE = /read_bytes\s*\(|write_text\s*\(|write_bytes\s*\(|['"](?:rb|br|rb\+|br\+|w|a|x|w\+|a\+|x\+|wb|ab|wb\+|ab\+)['"]/

/** Disabled-state with priority env > config > default-on (t76-minimum). */
export function docReadDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[OPT_OUT_ENV]
  if (raw !== undefined && raw.trim() !== "") {
    const value = raw.trim().toLowerCase()
    return value === "0" || value === "false" || value === "off" || value === "no"
  }
  const cfg = configValue(OPT_OUT_ENV)
  if (typeof cfg === "boolean") return !cfg
  return false
}

export function docReadRoute(): string {
  return (
    "[doc-read gate: BLOCKED] A script over a document is a scan, not reading: read the document " +
    "with the `read` tool — it prints the numbered lines you can cite and reason over. " +
    "Byte-level checks stay allowed (read_bytes / 'rb' / readFileSync without an encoding)."
  )
}

/** The refusal for a python/node script that reads a doc's TEXT, or undefined when it may run. */
export function docReadBlock(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (docReadDisabled(env)) return undefined
  if (!INTERPRETER.test(command)) return undefined
  if (!DOC_EXT.test(command)) return undefined
  if (BYTE_OR_WRITE.test(command)) return undefined
  if (!PY_TEXT_READ.test(command) && !NODE_TEXT_READ.test(command)) return undefined
  return docReadRoute()
}
