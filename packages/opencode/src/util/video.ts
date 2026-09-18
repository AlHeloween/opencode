import * as fs from "fs/promises"
import { existsSync } from "node:fs"
import * as os from "os"
import * as path from "path"

/**
 * Video frame extraction and duration probing for the read tool (2026-09-07):
 * when the target model has image input but NO native video support, a video
 * file is sampled into evenly spaced downscaled JPEG frames so a vision model
 * can still analyze the footage.
 *
 * Binary resolution (2026-09-18): `ffmpeg` and `ffprobe` are looked up NEXT TO
 * THE EXECUTABLE first (we ship them in `bin/`), then on PATH. PATH alone was
 * wrong in two ways — `where ffmpeg` on this host returns the SYSTEM copy while
 * the repo's own `bin/ffmpeg.exe` went unused, and `ffprobe` was not shipped at
 * all, so a portable install could not read a video at all: `duration` came back
 * 0 and the split path returned no frames. A missing binary degrades to the
 * markdownify stub; it never throws.
 *
 * Models WITH native video input skip this entirely — the video rides the
 * wire as a video_url content block (openrouter SDK maps video/* file parts).
 */

export interface VideoFrame {
  index: number
  timestamp: number
  base64: string
}

const MAX_FRAMES = 6
const MAX_WIDTH = 768

/**
 * Resolve a tool binary: exe-adjacent first (that is where we ship it), then
 * PATH. Mirrors the constitution guard's `cmd_runner` probe — a PATH-only
 * lookup silently ignores the binary that ships with the product.
 */
const toolPaths = new Map<string, string | null>()
function toolPath(name: "ffmpeg" | "ffprobe"): string | null {
  const cached = toolPaths.get(name)
  if (cached !== undefined) return cached
  const exeDir = path.dirname(process.execPath)
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""]
  const dirs = [exeDir, path.join(exeDir, "bin"), path.dirname(exeDir)]
  const found =
    dirs
      .flatMap((dir) => exts.map((ext) => path.join(dir, `${name}${ext}`)))
      .find((candidate) => existsSync(candidate)) ??
    Bun.which(name) ??
    null
  toolPaths.set(name, found)
  return found
}

async function run(cmd: string[], capture = false): Promise<{ ok: boolean; stdout: string }> {
  const name = cmd[0] === "ffmpeg" ? "ffmpeg" : cmd[0] === "ffprobe" ? "ffprobe" : undefined
  if (!name) return { ok: false, stdout: "" }
  // A missing binary is a degraded path, not an error: `probeDuration` returns 0
  // and `extractVideoFrames` returns [] so the caller falls back to the stub.
  const binary = toolPath(name)
  if (!binary) return { ok: false, stdout: "" }
  try {
    const proc = Bun.spawn([binary, ...cmd.slice(1)], { stdout: "pipe", stderr: "ignore", stdin: "ignore" })
    const stdout = capture ? await new Response(proc.stdout).text() : ""
    const code = await proc.exited
    return { ok: code === 0, stdout }
  } catch {
    // Spawn failure (deleted between probe and use, permissions): same degrade.
    return { ok: false, stdout: "" }
  }
}

async function probeDuration(filepath: string): Promise<number> {
  const { ok, stdout } = await run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filepath],
    true,
  )
  if (!ok) return 0
  const value = Number.parseFloat(stdout.trim().split(/\r?\n/)[0] ?? "")
  return Number.isFinite(value) ? value : 0
}

/**
 * Sample `count` evenly spaced frames from a video, scaled down for fast
 * model digestion. Returns [] when ffmpeg/ffprobe is unavailable or the
 * container has no measurable duration.
 */
export async function extractVideoFrames(
  filepath: string,
  opts?: { frames?: number; maxWidth?: number },
): Promise<VideoFrame[]> {
  const count = Math.max(1, Math.min(opts?.frames ?? MAX_FRAMES, 12))
  const maxWidth = opts?.maxWidth ?? MAX_WIDTH
  const duration = await probeDuration(filepath)
  if (!Number.isFinite(duration) || duration <= 0) return []

  const tmp = path.join(os.tmpdir(), `opencode-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await fs.mkdir(tmp, { recursive: true })
  try {
    const frames: VideoFrame[] = []
    for (let i = 0; i < count; i++) {
      const timestamp = duration * ((i + 0.5) / count)
      const out = path.join(tmp, `frame-${String(i).padStart(2, "0")}.jpg`)
      const { ok } = await run([
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-ss",
        timestamp.toFixed(3),
        "-i",
        filepath,
        "-frames:v",
        "1",
        "-vf",
        `scale='min(${maxWidth},iw)':-2`,
        "-q:v",
        "5",
        out,
      ])
      if (!ok) continue
      const bytes = await fs.readFile(out).catch(() => null)
      if (bytes && bytes.length > 0) {
        frames.push({ index: i, timestamp, base64: Buffer.from(bytes).toString("base64") })
      }
    }
    return frames
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}
