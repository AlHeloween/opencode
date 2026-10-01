import { isUtf8 } from "node:buffer"
import * as path from "path"
import { Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "text-codec" })

/**
 * ONE decoder for `read`, `edit` and `write` (plan 2026-10-01_hash-addressed-edits, H9).
 *
 * The three tools must see a file as the SAME text, or a hash `read` printed never resolves in `edit` — a BOM
 * kept by one side and stripped by the other refused every address of a BOM file, and a UTF-8-only decoder
 * turned the untouched Cyrillic of a cp1251 file into U+FFFD on an edit of an ASCII line (both measured,
 * `experiments/2026-10-01_chain-review/probe.ts`).
 *
 * Detection order: a BOM first (UTF-8, UTF-16 LE/BE — before the NUL bytes of UTF-16 could call it binary),
 * then the binary heuristic, then strict UTF-8, and only then ANSI in the HOST code page.
 *
 * ANSI is DECODED and never ENCODED: `TextEncoding` — the type every write takes — has no ANSI member. Owner,
 * 2026-10-01: «Обратное кодирование в cp1251 сносит все мультиязычные темы». A legacy file is converted to
 * UTF-8 BOM + CRLF at the moment it is saved, and the tool says so.
 */
export type TextEncoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be"
export type SourceEncoding = TextEncoding | "ansi"

export type Decoded =
  | { kind: "text"; encoding: TextEncoding; text: string }
  | { kind: "text"; encoding: "ansi"; codepage: string; text: string }
  | { kind: "binary" }
  | { kind: "undecodable"; reason: string }

export type LineEnding = "\r\n" | "\n"

const SAMPLE_BYTES = 4096

const BINARY_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".class", ".jar", ".war", ".7z", ".doc", ".docx", ".xls", ".xlsx",
  ".ppt", ".pptx", ".pdf", ".odt", ".ods", ".odp", ".bin", ".dat", ".obj", ".o", ".a", ".lib", ".wasm", ".pyc",
  ".pyo",
])

/**
 * Delphi sources. The Delphi tooling — the compiler reads a BOM-less file as ANSI, and the owner's entity scanner
 * is built for it — wants UTF-8 BOM + CRLF, so these are written in exactly that form, new or existing, and a
 * file that was anything else is normalised whole: «это кстати исправит ошибки если они были сделаны ранее».
 */
const DELPHI_EXTENSIONS = new Set([".pas", ".dpr", ".dpk", ".inc", ".dfm", ".dproj"])

export const isDelphi = (filePath: string) => DELPHI_EXTENSIONS.has(path.extname(filePath).toLowerCase())

/** The BOM's encoding, or undefined. UTF-32 LE (`FF FE 00 00`) is NOT UTF-16 — it falls through to binary. */
export function bomEncoding(bytes: Uint8Array): TextEncoding | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8-bom"
  if (bytes[0] === 0xff && bytes[1] === 0xfe && !(bytes[2] === 0 && bytes[3] === 0)) return "utf-16le"
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be"
  return undefined
}

/** The heuristic `read` has always used: a known binary extension, a NUL, or > 30 % control bytes in the sample. */
export function looksBinary(filePath: string, sample: Uint8Array): boolean {
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return true
  if (sample.length === 0) return false
  const head = sample.subarray(0, SAMPLE_BYTES)
  if (head.includes(0)) return true
  const control = head.filter((b) => b < 9 || (b > 13 && b < 32)).length
  return control / head.length > 0.3
}

// WHATWG labels for the Windows ANSI pages whose `windows-N` spelling the decoder does not accept.
const CODEPAGE_LABELS: Record<number, string> = { 932: "shift_jis", 936: "gbk", 949: "euc-kr", 950: "big5" }
let hostPage: { label: string | undefined } | undefined

/**
 * The host's ANSI code page as a decoder label — read from the OS, never assumed: a guessed page would decode a
 * legacy file into garbage and the conversion would make the garbage permanent. Windows only; elsewhere there
 * is no ANSI page and an undecodable file is refused.
 */
export function hostCodePage(): string | undefined {
  if (hostPage) return hostPage.label
  hostPage = { label: undefined }
  if (process.platform !== "win32") return undefined
  const result = Bun.spawnSync(["reg", "query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage", "/v", "ACP"])
  const page = Number(/ACP\s+REG_SZ\s+(\d+)/.exec(result.stdout.toString())?.[1])
  if (!Number.isInteger(page)) {
    log.warn("bug: host ANSI code page unreadable", { exitCode: result.exitCode, stderr: result.stderr.toString() })
    return undefined
  }
  const label = codePage(CODEPAGE_LABELS[page] ?? `windows-${page}`)
  if (label === undefined) log.warn("bug: host ANSI code page has no decoder", { page })
  hostPage = { label }
  return hostPage.label
}

/**
 * A legacy code page by any label the decoder knows — `cp1251`, `windows-1252`, `gbk`, `866` — as its CANONICAL
 * name, or undefined. The decoder is the judge: a label it does not know is no page at all, not a page to guess
 * around. A UTF label is refused: a file reaches the code-page path only because it is NOT valid UTF-8 and has
 * no BOM, so «read it as UTF-8» would decode it to U+FFFD and the save would make that permanent.
 */
export function codePage(label: string): string | undefined {
  const canonical = (() => {
    try {
      return new TextDecoder(label).encoding
    } catch (error) {
      log.debug("not a code page label", { label, error })
      return undefined
    }
  })()
  return canonical === undefined || canonical.startsWith("utf-") ? undefined : canonical
}

/**
 * `codepage` is the MODEL's choice for a legacy file (plan H10: «понять что там сможет только модель … cp1251 по
 * умолчанию, но можно выбирать»), already canonical (`codePage`); absent, the host's page. It never overrides
 * what the bytes SAY — a BOM or valid UTF-8 decides on its own.
 */
export function decode(bytes: Uint8Array, filePath: string, codepage?: string): Decoded {
  const bom = bomEncoding(bytes)
  if (bom === "utf-8-bom") return { kind: "text", encoding: bom, text: new TextDecoder("utf-8").decode(bytes.subarray(3)) }
  if (bom === "utf-16le" || bom === "utf-16be") {
    return { kind: "text", encoding: bom, text: new TextDecoder(bom, { ignoreBOM: true }).decode(bytes.subarray(2)) }
  }
  if (looksBinary(filePath, bytes)) return { kind: "binary" }
  if (isUtf8(bytes)) return { kind: "text", encoding: "utf-8", text: new TextDecoder("utf-8").decode(bytes) }
  const page = codepage ?? hostCodePage()
  if (page === undefined) {
    return {
      kind: "undecodable",
      reason: "not UTF-8, no BOM, and this host has no ANSI code page — pass `encoding` with the file's code page",
    }
  }
  return { kind: "text", encoding: "ansi", codepage: page, text: new TextDecoder(page).decode(bytes) }
}

export function encode(text: string, encoding: TextEncoding): Uint8Array {
  if (encoding === "utf-8") return new Uint8Array(Buffer.from(text, "utf-8"))
  if (encoding === "utf-8-bom") return new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(text, "utf-8")])
  const le = Buffer.from(text, "utf16le")
  if (encoding === "utf-16le") return new Uint8Array([0xff, 0xfe, ...le])
  return new Uint8Array([0xfe, 0xff, ...le.swap16()])
}

/**
 * What a write must produce. `ending` present = the WHOLE file is normalised to it (Delphi, or a converted ANSI
 * file); absent = the file keeps its own endings and only new lines are fitted to its majority ending.
 * `source` undefined = a new file: Delphi gets its form, anything else is written as the agent sent it.
 */
export function target(
  filePath: string,
  source: SourceEncoding | undefined,
): { encoding: TextEncoding; ending?: LineEnding } {
  if (isDelphi(filePath) || source === "ansi") return { encoding: "utf-8-bom", ending: "\r\n" }
  return { encoding: source ?? "utf-8" }
}

/** The MAJORITY ending — a mixed file is fitted to what most of it already is, so an edit adds no mixing. */
export function lineEnding(text: string): LineEnding | undefined {
  const crlf = text.split("\r\n").length - 1
  const lf = text.split("\n").length - 1 - crlf
  if (crlf === 0 && lf === 0) return undefined
  return crlf > lf ? "\r\n" : "\n"
}

/** Rewrites every CRLF and LF to `ending`. A lone CR is content, not a break — `read` never splits on it. */
export function normalizeEndings(text: string, ending: LineEnding): string {
  return text.replace(/\r?\n/g, ending)
}

/** «UTF-8 with BOM, CRLF» — the form a conversion notice names, from and to. */
export function describe(encoding: SourceEncoding, codepage: string | undefined, text: string) {
  const name = encoding === "ansi" ? `ANSI ${codepage}` : encoding.toUpperCase().replace("-BOM", " with BOM")
  const crlf = text.split("\r\n").length - 1
  const lf = text.split("\n").length - 1 - crlf
  if (crlf > 0 && lf > 0) return `${name}, mixed CRLF/LF`
  if (crlf > 0) return `${name}, CRLF`
  if (lf > 0) return `${name}, LF`
  return name
}

/**
 * The form a write produces from `text`, and — when it differs from what the file or the agent had — the notice
 * that NAMES the difference: the owner's «агент получает уведомление», so a conversion is never silent.
 *
 * `source` is the file as it was decoded (undefined, or not text: a new file). `ending` is the ending the
 * CALLER wants the whole text fitted to (`write`: the existing file's majority); a Delphi or ANSI target
 * overrides it with CRLF. `edit` passes none: its new lines were already fitted, and a non-Delphi file keeps
 * whatever lines it already had.
 */
export function fit(filePath: string, source: Decoded | undefined, text: string, ending?: LineEnding) {
  const sent = text.charCodeAt(0) === 0xfeff ? { bom: true, text: text.slice(1) } : { bom: false, text }
  const original = source?.kind === "text" ? source : undefined
  const form = target(filePath, original?.encoding)
  // An agent that sends a BOM for a plain UTF-8 file gets one — the union `write` has always honoured.
  const encoding: TextEncoding = form.encoding === "utf-8" && sent.bom ? "utf-8-bom" : form.encoding
  const forced = form.ending ?? ending
  const out = forced === undefined ? sent.text : normalizeEndings(sent.text, forced)
  const fromEncoding = original?.encoding ?? (sent.bom ? "utf-8-bom" : "utf-8")
  if (fromEncoding === encoding && out === sent.text) return { encoding, ending: form.ending, text: out }
  const from = describe(fromEncoding, original?.encoding === "ansi" ? original.codepage : undefined, sent.text)
  const why =
    original?.encoding === "ansi"
      ? ` — a legacy code page cannot hold every script. It was read as ${original.codepage}; if that was not its code page, \`restore\` the backup (it holds the original bytes) and edit again with \`encoding\` set to the right one`
      : isDelphi(filePath)
        ? " — Delphi sources are kept in UTF-8 with BOM and CRLF"
        : ""
  return {
    encoding,
    ending: form.ending,
    text: out,
    notice: `converted from ${from} to ${describe(encoding, undefined, out)}${why}.`,
  }
}

/**
 * After a formatter rewrote the file: put it back in the form the write chose, and return the text it now holds.
 * Replaces `Bom.syncFile`, which re-read every file as UTF-8 — a formatter run over a UTF-16 file would have been
 * «synced» into UTF-8 mojibake.
 */
export const syncFile = Effect.fn("TextCodec.syncFile")(function* (
  fs: AppFileSystem.Interface,
  filePath: string,
  encoding: TextEncoding,
  ending: LineEnding | undefined,
) {
  const decoded = decode(yield* fs.readFile(filePath), filePath)
  if (decoded.kind !== "text") return yield* Effect.fail(new Error(`${filePath}: the formatter left a file that is not text`))
  const text = ending === undefined ? decoded.text : normalizeEndings(decoded.text, ending)
  if (decoded.encoding !== encoding || text !== decoded.text) yield* fs.writeWithDirs(filePath, encode(text, encoding))
  return text
})
