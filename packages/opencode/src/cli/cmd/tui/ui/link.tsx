import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import open from "open"
import * as Log from "@opencode-ai/core/util/log"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
}

/**
 * Link component that renders clickable hyperlinks.
 * Clicking anywhere on the link text opens the URL in the default browser.
 */
export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href

  return (
    <text
      fg={props.fg}
      onMouseUp={() => {
        open(props.href).catch((e) => Log.Default.debug("open URL failed", { href: props.href.slice(0, 100), error: String(e) }))
      }}
    >
      {displayText}
    </text>
  )
}
