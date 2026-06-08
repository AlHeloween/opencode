import path from "path"
import { Process } from "./process"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "./filesystem"
import * as Log from "@opencode-ai/core/util/log"

const MARKDOWNIFY_BIN = "opencode-markdownify"

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

export async function initMarkdownify() {}

export async function convertDocument(bytes: Uint8Array, filename: string, opts?: { tail?: number }): Promise<string> {
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
