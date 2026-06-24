import { useTheme } from "@tui/context/theme"
import { which } from "@/util/which"

type AudioMetadata = {
  mime?: string
  url?: string
  filename?: string
  duration?: number
  sampleRate?: number
  channels?: number
  codec?: string
}

export function MediaAudio(props: { url: string; metadata?: AudioMetadata }) {
  const { theme } = useTheme()
  const mpvPath = which("mpv")

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
      <text fg={theme.textMuted}>
        {mpvPath ? "mpv available for external playback" : "mpv not installed - audio playback unavailable"}
      </text>
    </box>
  )
}
