import path from "path"
import fs from "fs/promises"
import { Process } from "./process"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "./filesystem"
import * as Log from "@opencode-ai/core/util/log"

const MARKDOWNIFY_BIN = "opencode-markdownify"

let cachedBinPath: string | null = null

async function resolveBinPath(): Promise<string | null> {
  if (cachedBinPath) return cachedBinPath

  const ext = process.platform === "win32" ? ".exe" : ""
  const name = MARKDOWNIFY_BIN + ext

  // Check if binary exists in Global.Path.bin (embedded by build process)
  const bundled = path.join(Global.Path.bin, name)
  if (await Filesystem.exists(bundled)) {
    cachedBinPath = bundled
    return bundled
  }

  // Check if binary is adjacent to the opencode executable
  const exePath = process.argv0 || process.execPath
  const exeDir = path.dirname(exePath)
  const adjacent = path.join(exeDir, name)
  if (await Filesystem.exists(adjacent)) {
    cachedBinPath = adjacent
    return adjacent
  }

  // Development: check dist/<platform>/bin/ adjacent to package root
  const platformDir = `opencode-${process.platform}-${process.arch}`
  const devBin = path.join(__dirname, "..", "..", "..", "dist", platformDir, "bin", name)
  if (await Filesystem.exists(devBin)) {
    cachedBinPath = devBin
    return devBin
  }

  // Not found
  cachedBinPath = null
  return null
}

export async function initMarkdownify() {}

export async function convertDocument(bytes: Uint8Array, filename: string, opts?: { tail?: number }): Promise<string> {
  const binPath = await resolveBinPath()
  if (!binPath) {
    Log.Default.warn("markdownify binary not found, skipping conversion", { filename })
    return ""
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
    return ""
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
