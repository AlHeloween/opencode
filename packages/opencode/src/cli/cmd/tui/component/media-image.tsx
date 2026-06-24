import { createSignal, onMount, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { execFileSync } from "child_process"
import { writeFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { which } from "@/util/which"
import { Spinner } from "./spinner"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.image" })

function removeTempFile(file: string) {
  try {
    unlinkSync(file)
  } catch (error) {
    log.debug("failed to remove temp image", { error: String(error) })
  }
}

function renderChafa(url: string): string | null {
  const base64 = url.split(",")[1]
  if (!base64 || base64.length === 0) return null

  const chafaPath = which("chafa")
  if (!chafaPath) return null

  const ext = url.startsWith("data:image/png") ? ".png"
    : url.startsWith("data:image/jpeg") ? ".jpg"
    : url.startsWith("data:image/webp") ? ".webp"
    : url.startsWith("data:image/gif") ? ".gif"
    : ".png"

  const tmpFile = join(tmpdir(), `opencode_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`)

  try {
    writeFileSync(tmpFile, Buffer.from(base64, "base64"))
    const cols = process.stdout.columns ?? 80
    const rows = Math.floor((process.stdout.rows ?? 24) * 0.45)
    const output = execFileSync(
      chafaPath,
      ["--format", "symbols", "--color-space", "rgb", "--size", `${cols}x${rows}`, tmpFile],
      { encoding: "utf-8", timeout: 8000, maxBuffer: 4 * 1024 * 1024 },
    )
    return output
  } catch (error) {
    log.debug("failed to render image with chafa", { error: String(error) })
    return null
  } finally {
    removeTempFile(tmpFile)
  }
}

export function MediaImage(props: { url: string; mime: string }) {
  const { theme } = useTheme()
  const [output, setOutput] = createSignal<string | null>(null)
  const [loaded, setLoaded] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  onMount(() => {
    const result = renderChafa(props.url)
    if (result === null) {
      if (!which("chafa")) {
        setError("chafa not installed - install chafa for terminal image rendering")
      } else {
        setError("Could not render image")
      }
    }
    setOutput(result)
    setLoaded(true)
  })

  return (
    <Switch>
      <Match when={error()}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <text fg={theme.textMuted}>{error()!}</text>
        </box>
      </Match>
      <Match when={loaded()}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <text fg={theme.text}>{output() ?? ""}</text>
        </box>
      </Match>
      <Match when={true}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <Spinner color={theme.textMuted} />
          <text fg={theme.textMuted}>Rendering image...</text>
        </box>
      </Match>
    </Switch>
  )
}
