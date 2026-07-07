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

  const meta = props.metadata ?? {}
  const duration = meta.duration ? `${meta.duration}s` : "?"
  const sampleRate = meta.sampleRate ? `${(meta.sampleRate / 1000).toFixed(1)}kHz` : "?"
  const channels = meta.channels ? `${meta.channels}ch` : "?"
  const codec = meta.codec ?? "?"
  const filename = meta.filename ? ` | ${meta.filename}` : ""

  return (
    <box paddingTop={1} paddingLeft={2} paddingBottom={1} gap={1}>
      <text fg={theme.text}>
        🔊 {duration} | {sampleRate} | {channels} | {codec}{filename}
      </text>
      <text fg={theme.textMuted}>
        {which("mpv")
          ? "mpv available — use `mpv <file>` for playback"
          : "mpv not installed — install for audio playback"}
      </text>
    </box>
  )
}
