import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { which } from "@/util/which"

function writeTempFile(url: string): string {
  const base64 = url.split(",")[1]
  const ext = url.startsWith("data:audio/mpeg") ? ".mp3"
    : url.startsWith("data:audio/wav") ? ".wav"
    : url.startsWith("data:audio/ogg") ? ".ogg"
    : url.startsWith("data:audio/flac") ? ".flac"
    : ".audio"
  const tmpFile = join(tmpdir(), `opencode_audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`)
  if (base64) writeFileSync(tmpFile, Buffer.from(base64, "base64"))
  return tmpFile
}

function launchAudio(url: string) {
  const mpvPath = which("mpv")
  if (!mpvPath) return
  const tmpFile = writeTempFile(url)
  const { exec } = require("child_process")
  exec(`"${mpvPath}" --vo=null --really-quiet "${tmpFile}"`, { windowsHide: true })
}

export function MediaAudio(props: { url: string; metadata?: Record<string, any> }) {
  const { theme } = useTheme()

  const meta = props.metadata ?? {}
  const duration = meta.duration ? `${meta.duration}s` : "?"
  const sampleRate = meta.sampleRate ? `${(meta.sampleRate / 1000).toFixed(1)}kHz` : "?"
  const channels = meta.channels ? `${meta.channels}ch` : "?"
  const codec = meta.codec ?? "?"

  return (
    <box paddingTop={1} paddingLeft={2} gap={1}>
      <text fg={theme.textMuted}>
        Audio | {duration} | {sampleRate} | {channels} | {codec}
      </text>
      <Show when={which("mpv")}>
        <text fg={theme.accent}>
          ▶ Play (mpv audio)
        </text>
      </Show>
      <Show when={!which("mpv")}>
        <text fg={theme.textMuted}>mpv not installed — audio playback unavailable</text>
      </Show>
    </box>
  )
}
