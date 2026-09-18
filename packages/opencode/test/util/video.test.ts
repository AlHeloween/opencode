import { describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { extractVideoFrames } from "../../src/util/video"

/**
 * The degraded paths, which is what the contract actually promises.
 *
 * Frame extraction sits behind `probeDuration` (ffprobe) and `ffmpeg`: a zero or
 * unmeasurable duration returns BEFORE any frame is cut, so a missing ffprobe
 * makes the whole video path a no-op. That must be a silent fall-through to the
 * markdownify stub — never a thrown error in the read tool.
 *
 * Resolved 2026-09-18: `ffprobe` was not shipped in `bin/` at all while
 * `ffmpeg.exe` was, and resolution was PATH-only, so `where ffmpeg` returned the
 * SYSTEM copy and the repo's own went unused. The binaries are now looked up
 * exe-adjacent first; these cases pin that a missing/broken input still degrades
 * rather than throws.
 */
describe("extractVideoFrames", () => {
  test("returns [] for a path that does not exist, instead of throwing", async () => {
    const missing = path.join(os.tmpdir(), `opencode-no-such-video-${Date.now()}.mp4`)
    expect(await extractVideoFrames(missing)).toEqual([])
  })

  test("returns [] for a file with no measurable duration", async () => {
    const tmp = path.join(os.tmpdir(), `opencode-not-a-video-${Date.now()}.bin`)
    await fs.writeFile(tmp, "this is not a video, and ffprobe will find no duration in it")
    try {
      // Not a single frame: duration is the gate, and without it there is
      // nothing to space frames across.
      expect(await extractVideoFrames(tmp)).toEqual([])
    } finally {
      await fs.rm(tmp, { force: true })
    }
  })

  test("an impossible frame count is clamped, not passed through", async () => {
    // `opts.frames` is clamped to 1..12 regardless of input, so a caller cannot
    // ask for thousands of ffmpeg invocations on one video.
    const tmp = path.join(os.tmpdir(), `opencode-clamp-${Date.now()}.bin`)
    await fs.writeFile(tmp, "still not a video")
    try {
      expect(await extractVideoFrames(tmp, { frames: 10_000 })).toEqual([])
    } finally {
      await fs.rm(tmp, { force: true })
    }
  })
})
