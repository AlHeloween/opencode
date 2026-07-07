/**
 * MediaImage — renders images via @opentui/core/3d (Three.js + WebGPU).
 *
 * Single path: <image-plane> → TexturePlaneRenderable → ThreeRenderable → WebGPU.
 * No chafa, no escape codes — OpenTUI's native 3D pipeline is the only renderer.
 */
import { createSignal, createResource, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "./spinner"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.image" })

export function MediaImage(props: { url: string; mime: string }) {
  const { theme } = useTheme()
  const [ready, setReady] = createSignal(false)

  createResource(
    () => props.url,
    (url: string) => {
      if (url) {
        log.debug("MediaImage: loading via WebGPU", { mime: props.mime })
        setReady(true)
      }
    },
  )

  return (
    <Switch>
      <Match when={ready()}>
        <image-plane url={props.url} mime={props.mime} width={70} />
      </Match>
      <Match when={true}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <Spinner color={theme.textMuted} />
          <text fg={theme.textMuted}>Rendering via WebGPU...</text>
        </box>
      </Match>
    </Switch>
  )
}
