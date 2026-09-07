import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

/**
 * Video frame extraction for the read tool's "split" path (2026-09-07):
 * when the target model has image input but NO native video support, a video
 * file is sampled into evenly spaced downscaled JPEG frames so a vision model
 * can still analyze the footage. Requires ffmpeg/ffprobe on PATH; when
 * unavailable the caller falls back to the markdownify stub.
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

async function run(cmd: string[], capture = false): Promise<{ ok: boolean; stdout: string }> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" })
    const stdout = capture ? await new Response(proc.stdout).text() : ""
    const code = await proc.exited
    return { ok: code === 0, stdout }
  } catch {
    // ENOENT etc — ffmpeg/ffprobe not installed
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
