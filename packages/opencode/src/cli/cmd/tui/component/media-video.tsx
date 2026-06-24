import { createSignal, onMount, Show, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { execSync } from "child_process"
import { writeFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { which } from "@/util/which"
import { Spinner } from "./spinner"

function writeTempFile(url: string, prefix: string, ext: string): string {
  const base64 = url.split(",")[1]
  const tmpFile = join(tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`)
  if (base64) writeFileSync(tmpFile, Buffer.from(base64, "base64"))
  return tmpFile
}

function renderThumbnail(url: string): string | null {
  const chafaPath = which("chafa")
  const ffmpegPath = which("ffmpeg")
  if (!chafaPath || !ffmpegPath) return null

  const tmpVideo = writeTempFile(url, "opencode_vid", ".mp4")
  const tmpImg = join(tmpdir(), `opencode_vthumb_${Date.now()}.png`)

  try {
    execSync(
      `${ffmpegPath} -y -i "${tmpVideo}" -vframes 1 -f image2 "${tmpImg}" 2>nul`,
      { encoding: "utf-8", timeout: 15000 },
    )
    const cols = process.stdout.columns ?? 80
    const rows = Math.floor((process.stdout.rows ?? 24) * 0.3)
    const output = execSync(
      `${chafaPath} --format symbols --color-space rgb --size ${cols}x${rows} "${tmpImg}"`,
      { encoding: "utf-8", timeout: 8000, maxBuffer: 4 * 1024 * 1024 },
    )
    return output
  } catch {
    return null
  } finally {
    try { unlinkSync(tmpVideo) } catch { /* temp cleanup */ }
    try { unlinkSync(tmpImg) } catch { /* temp cleanup */ }
  }
}

function launchPlayer(url: string) {
  const mpvPath = which("mpv")
  if (!mpvPath) return
  const tmpFile = writeTempFile(url, "opencode_vplay", ".mp4")
  const { exec } = require("child_process")
  exec(`start "" "${mpvPath}" --vo=gpu "${tmpFile}"`, { windowsHide: false })
}

export function MediaVideo(props: { url: string; metadata?: Record<string, any> }) {
  const { theme } = useTheme()
  const [thumbnail, setThumbnail] = createSignal<string | null>(null)
  const [loaded, setLoaded] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

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
        <text fg={theme.accent}>
          ▶ Press to play (opens in mpv window)
        </text>
      </Show>
      <Show when={!which("mpv")}>
        <text fg={theme.textMuted}>mpv not installed — video playback unavailable</text>
      </Show>
    </box>
  )
}
