import { createSignal, onMount, Show, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { execFileSync } from "child_process"
import { writeFileSync, unlinkSync, readFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { which } from "@/util/which"
import { Spinner } from "./spinner"
import { MediaImage } from "./media-image"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.video" })

type VideoMetadata = {
  mime?: string; url?: string; filename?: string
  duration?: number; width?: number; height?: number; fps?: number
}

function extractKeyframe(url: string): string | null {
  const ffmpeg = which("ffmpeg")
  if (!ffmpeg) return null

  const base64 = url.split(",")[1]
  if (!base64) return null

  const vidFile = join(tmpdir(), `opencode_vid_${Date.now()}.mp4`)
  const imgFile = join(tmpdir(), `opencode_vthumb_${Date.now()}.png`)

  try {
    writeFileSync(vidFile, Buffer.from(base64, "base64"))
    execFileSync(ffmpeg, [
      "-y", "-i", vidFile, "-vframes", "1", "-f", "image2", imgFile,
    ], { stdio: ["ignore", "ignore", "ignore"], timeout: 15000 })

    const png = readFileSync(imgFile)
    const pngBase64 = png.toString("base64")
    return `data:image/png;base64,${pngBase64}`
  } catch (err) {
    log.debug("video keyframe extraction failed", { error: String(err) })
    return null
  } finally {
    try { if (existsSync(vidFile)) unlinkSync(vidFile) } catch { /* cleanup */ }
    try { if (existsSync(imgFile)) unlinkSync(imgFile) } catch { /* cleanup */ }
  }
}

export function MediaVideo(props: { url: string; metadata?: VideoMetadata }) {
  const { theme } = useTheme()
  const [thumbnail, setThumbnail] = createSignal<string | null>(null)
  const [loaded, setLoaded] = createSignal(false)

  const meta = props.metadata ?? {}
  const duration = meta.duration ? `${meta.duration}s` : "?"
  const dims = meta.width && meta.height ? `${meta.width}x${meta.height}` : "?"
  const fps = meta.fps ? `${meta.fps}fps` : "?"
  const filename = meta.filename ? ` | ${meta.filename}` : ""

  onMount(() => {
    setThumbnail(extractKeyframe(props.url))
    setLoaded(true)
  })

  return (
    <box paddingTop={1} paddingLeft={2} paddingBottom={1} gap={1}>
      <text fg={theme.text}>
        🎬 {duration} | {dims} | {fps}{filename}
      </text>
      <Switch>
        <Match when={loaded() && thumbnail()}>
          <MediaImage url={thumbnail()!} mime="image/png" />
        </Match>
        <Match when={loaded() && !thumbnail()}>
          <text fg={theme.textMuted}>No preview — ffmpeg not available</text>
        </Match>
        <Match when={true}>
          <Spinner color={theme.textMuted} />
          <text fg={theme.textMuted}>Extracting keyframe...</text>
        </Match>
      </Switch>
      <text fg={theme.textMuted}>
        {which("mpv")
          ? "mpv available — use `mpv <file>` for playback"
          : "mpv not installed"}
      </text>
    </box>
  )
}
