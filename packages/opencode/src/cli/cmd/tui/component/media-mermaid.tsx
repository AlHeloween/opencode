/**
 * MediaMermaid — renders mermaid diagrams inline.
 *
 * Pipeline:
 *   1. Native terminals: Mermaid WASM → SVG → RGBA → OpenTUI ImageRenderable.
 *   2. Other terminals: render a PNG only for MediaImage's symbols fallback.
 */
import { useTheme } from "@tui/context/theme"
import { renderMermaidToPngDataUrl, renderMermaidToRgba } from "@/util/mermaid"
import { MediaImage } from "./media-image"

export function MediaMermaid(props: { source: string }) {
  const { mode } = useTheme()
  const options = () => {
    const background = mode() === "dark" ? "#1a1b26" : "#ffffff"
    return { theme: mode() === "dark" ? "dark" as const : "default" as const, background }
  }

  return <MediaImage
    mime="image/png"
    layout="diagram"
    renderNative={(budget) => renderMermaidToRgba(props.source, { ...options(), budget })}
    fallbackDataUrl={() => renderMermaidToPngDataUrl(props.source, options())}
  />
}
