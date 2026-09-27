/**
 * MediaMermaid — renders mermaid diagrams inline.
 *
 * Pipeline:
 *   1. Native terminals: Mermaid WASM → SVG → RGBA → OpenTUI ImageRenderable.
 *   2. Other terminals: render a PNG only for MediaImage's symbols fallback.
 */
import { RGBA } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { renderMermaidToPngDataUrl, renderMermaidToRgba } from "@/util/mermaid"
import { MediaImage } from "./media-image"

/** RGBA (0..1 floats) → `#rrggbb`. The renderer takes a CSS hex string and RGBA has no hex
 *  method of its own — its `toString()` yields `rgba(...)`, which resvg will not take. */
function toHex(color: RGBA): string {
  const byte = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel * 255)))
      .toString(16)
      .padStart(2, "0")
  return `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`
}

export function MediaMermaid(props: { source: string }) {
  const theme = useTheme()
  const options = () => {
    // The face comes from the ACTIVE theme, not from a literal. A hardcoded "#1a1b26" made the
    // diagram's fill lighter than whatever terminal it landed in — measured 2026-09-26 on the
    // owner's dark theme, where the node fill visibly detached from the background. Same class as
    // the protocol cell: the value existed, a different one was read.
    const background = toHex(theme.theme.background)
    return { theme: theme.mode() === "dark" ? "dark" as const : "default" as const, background }
  }

  return <MediaImage
    mime="image/png"
    layout="diagram"
    renderNative={(budget) => renderMermaidToRgba(props.source, { ...options(), budget })}
    fallbackDataUrl={() => renderMermaidToPngDataUrl(props.source, options())}
  />
}
