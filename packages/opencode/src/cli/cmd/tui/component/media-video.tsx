import { createSignal, onMount, Show, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { execFileSync } from "child_process"
import { writeFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { which } from "@/util/which"
import { Spinner } from "./spinner"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.video" })

type VideoMetadata = {
  mime?: string
  url?: string
  filename?: string
  duration?: number
  width?: number
  height?: number
  fps?: number
}

function writeTempFile(url: string, prefix: string, ext: string): string | undefined {
  const base64 = url.split(",")[1]
  if (!base64) return undefined
  const tmpFile = join(tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`)
  writeFileSync(tmpFile, Buffer.from(base64, "base64"))
  return tmpFile
}

function removeTempFile(file: string | undefined) {
  if (!file) return
  try {
    unlinkSync(file)
  } catch (error) {
    log.debug("failed to remove temp video file", { error: String(error) })
  }
}

function renderThumbnail(url: string): string | null {
  const chafaPath = which("chafa")
  const ffmpegPath = which("ffmpeg")
  if (!chafaPath || !ffmpegPath) return null

  const tmpVideo = writeTempFile(url, "opencode_vid", ".mp4")
  if (!tmpVideo) return null
  const tmpImg = join(tmpdir(), `opencode_vthumb_${Date.now()}.png`)

  try {
    execFileSync(
      ffmpegPath,
      ["-y", "-i", tmpVideo, "-vframes", "1", "-f", "image2", tmpImg],
      { stdio: ["ignore", "ignore", "ignore"], timeout: 15000 },
    )
    const cols = process.stdout.columns ?? 80
    const rows = Math.floor((process.stdout.rows ?? 24) * 0.3)
    const output = execFileSync(
      chafaPath,
      ["--format", "symbols", "--color-space", "rgb", "--size", `${cols}x${rows}`, tmpImg],
      { encoding: "utf-8", timeout: 8000, maxBuffer: 4 * 1024 * 1024 },
    )
    return output
  } catch (error) {
    log.debug("failed to render video thumbnail", { error: String(error) })
    return null
  } finally {
    removeTempFile(tmpVideo)
    removeTempFile(tmpImg)
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

  onMount(() => {
    const result = renderThumbnail(props.url)
    setThumbnail(result)
    setLoaded(true)
  })

  return (
    <box paddingTop={1} paddingLeft={2} gap={1}>
      <text fg={theme.textMuted}>
        Video | {duration} | {dims} | {fps}
      </text>
      <Switch>
        <Match when={loaded()}>
          <Show when={thumbnail()} fallback={<text fg={theme.textMuted}>No preview available</text>}>
            <text fg={theme.text}>{thumbnail()!}</text>
          </Show>
        </Match>
        <Match when={true}>
          <Spinner color={theme.textMuted} />
          <text fg={theme.textMuted}>Loading preview...</text>
        </Match>
      </Switch>
      <Show when={which("mpv")}>
        <text fg={theme.textMuted}>mpv available for external playback</text>
      </Show>
      <Show when={!which("mpv")}>
        <text fg={theme.textMuted}>mpv not installed - video playback unavailable</text>
      </Show>
    </box>
  )
}
