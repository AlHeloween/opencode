import path from "path"
import { Process } from "./process"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "./filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { readWasmAsset } from "./wasm-path"

const MARKDOWNIFY_BIN = "opencode-markdownify"

// ------------------------------------------------------------------
// WASM module (preferred — in-process, fast, no process spawn)
// ------------------------------------------------------------------

let _wasmInit: Promise<boolean> | null = null
let _wasmAvailable = false
// wasm-bindgen functions — typed via the module's @ts-self-types
let _wasmConvert: ((bytes: Uint8Array, filename: string) => string) | null = null
let _wasmIsSupported: ((ext: string) => boolean) | null = null

async function tryLoadWasm(): Promise<boolean> {
  if (_wasmAvailable) return true
  if (_wasmInit) return _wasmInit

  _wasmInit = (async () => {
    try {
      const asset = await readWasmAsset("markdownify/markdownify_wasm_bg.wasm")
      if (!asset.bytes) {
        Log.Default.debug("markdownify: wasm asset not found, trying native binary")
        return false
      }

      // Dynamic import of the wasm-bindgen JS glue
      const mod: any = await import("../../../wasm/markdownify/pkg/markdownify_wasm.js")

      // Initialize with pre-loaded bytes (avoids URL/fetch path)
      // wasm-bindgen v0.2.100 deprecated positional init args; pass a single object
      await mod.default({ module_or_path: new Uint8Array(asset.bytes) })

      _wasmConvert = mod.convert_to_markdown
      _wasmIsSupported = mod.is_supported_extension
      _wasmAvailable = true
      Log.Default.debug("markdownify: wasm loaded from " + (asset.path ?? "embedded"))
      return true
    } catch (err) {
      Log.Default.debug("markdownify: wasm load failed: " + (err instanceof Error ? err.message : String(err)))
      return false
    }
  })()

  return _wasmInit
}

// ------------------------------------------------------------------
// Native binary fallback
// ------------------------------------------------------------------

let cachedBinPath: string | null = null

function markdownifyName() {
  return MARKDOWNIFY_BIN + (process.platform === "win32" ? ".exe" : "")
}

function hasPathSeparator(value: string) {
  return value.includes("/") || value.includes("\\")
}

function binCandidates(name: string) {
  const candidates: string[] = []
  const add = (candidate: string | undefined) => {
    if (!candidate) return
    const normalized = path.normalize(candidate)
    if (!candidates.includes(normalized)) candidates.push(normalized)
  }

  add(path.join(Global.Path.bin, name))
  add(path.join(Global.Path.config, "tools", name))
  add(path.join(Global.Path.config, name))
  add(path.join(path.dirname(process.execPath), name))

  const argv0 = process.argv0 || ""
  if (argv0 && (path.isAbsolute(argv0) || hasPathSeparator(argv0))) {
    add(path.join(path.dirname(path.resolve(process.cwd(), argv0)), name))
  }

  add(path.join(Global.Path.home, "bin", name))
  add(path.join(process.cwd(), "bin", name))

  // Source checkout fallback for development/test runs where process.execPath is Bun or Node.
  add(path.join(__dirname, "..", "..", "..", "..", "bin", name))

  const platformDir = `opencode-${process.platform}-${process.arch}`
  add(path.join(__dirname, "..", "..", "..", "dist", platformDir, "bin", name))
  add(path.join(__dirname, "..", "..", "..", "..", "dist", platformDir, "bin", name))

  return candidates
}

async function resolveBinPath(): Promise<string | null> {
  if (cachedBinPath) return cachedBinPath

  for (const candidate of binCandidates(markdownifyName())) {
    if (await Filesystem.exists(candidate)) {
      cachedBinPath = candidate
      return candidate
    }
  }

  cachedBinPath = null
  return null
}

async function convertViaBinary(bytes: Uint8Array, filename: string, opts?: { tail?: number }): Promise<string> {
  const binPath = await resolveBinPath()
  if (!binPath) {
    const candidates = binCandidates(markdownifyName())
    Log.Default.warn("markdownify binary not found", { filename, candidates })
    throw new Error(`Document conversion failed: ${MARKDOWNIFY_BIN} not found`)
  }

  const args = [filename]
  if (opts?.tail !== undefined) {
    args.push("--tail", opts.tail.toString())
  }

  const proc = Process.spawn([binPath, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  proc.stdin!.end(bytes)

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? consumeStream(proc.stdout) : "",
    proc.stderr ? consumeStream(proc.stderr) : "",
    proc.exited,
  ])

  if (exitCode !== 0) {
    Log.Default.warn("markdownify failed", { filename, exitCode, stderr: stderr.trim() })
    throw new Error(`Document conversion failed: ${stderr.trim() || `${MARKDOWNIFY_BIN} exited with code ${exitCode}`}`)
  }

  return stdout
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Initialize markdownify. Tries WASM first, native binary second.
 * Safe to call multiple times.
 */
export async function initMarkdownify(): Promise<void> {
  await tryLoadWasm()
}

/**
 * Convert a document (binary bytes + filename) to markdown.
 *
 * Strategy:
 *   WASM first (in-process, synchronous after init, no spawn overhead)
 *   → native binary fallback (full-featured, handles 7z)
 *
 * `tail` is applied in JS for the WASM path; the native binary handles it
 * via `--tail`.
 */
export async function convertDocument(bytes: Uint8Array, filename: string, opts?: { tail?: number }): Promise<string> {
  const wasmOk = await tryLoadWasm()
  if (wasmOk && _wasmConvert) {
    try {
      const markdown = _wasmConvert(bytes, filename)
      if (opts?.tail !== undefined && opts.tail > 0) {
        return tailLines(markdown, opts.tail)
      }
      return markdown
    } catch (err) {
      Log.Default.debug("markdownify: wasm convert failed, trying native binary", {
        filename,
        error: String(err),
      })
      // Fall through to native binary
    }
  }

  return convertViaBinary(bytes, filename, opts)
}

function tailLines(text: string, n: number): string {
  const lines = text.split(/\r?\n/)
  if (lines.length <= n) return text
  return lines.slice(lines.length - n).join("\n")
}

async function consumeStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString()
}

export function isSupportedDocumentFormat(ext: string): boolean {
  const lower = ext.toLowerCase()
  return DOCUMENT_EXTENSIONS.has(lower)
}

export function getSupportedExtensions(): string[] {
  return Array.from(DOCUMENT_EXTENSIONS)
}

const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "xlsx",
  "xlsm",
  "xlsb",
  "pptx",
  "pptm",
  "csv",
  "ods",
  "odt",
  "odp",
  "html",
  "htm",
  "xml",
  "json",
  "txt",
  "md",
  "rss",
  "atom",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "bmp",
  "tiff",
  "tif",
  "webp",
  "svg",
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "aac",
  "flac",
  "weba",
  "mp4",
  "mov",
  "avi",
  "wmv",
  "flv",
  "webm",
  "mkv",
  "m4v",
  "mpg",
  "mpeg",
  "zip",
  "tar",
  "gz",
  "7z",
])
