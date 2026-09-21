/** @jsxImportSource @opentui/solid */
/**
 * Regression: the native (pixel) branch of MediaImage must give its `<image>`
 * renderable a non-zero cell box.
 *
 * Why this test exists (measured 2026-09-21, dist binary 10.0.1057): after the
 * OpenTUI 0.5.11 re-base, `<image>` no longer takes `data`/`imageWidth`/`imageHeight`
 * and has no Yoga measure function — `ImageRenderable.renderSelf` returns early on
 * `width <= 0 || height <= 0` (Image.ts:184). The runtime trace showed the frame
 * mounted with `layoutWidth: 0, layoutHeight: 0`, the box reserving rows through
 * `minHeight`, and no pixels on screen (mermaid and pasted screenshots alike).
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { CliRenderEvents, ImageRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import sharp from "sharp"
import { MediaImage } from "../../src/cli/cmd/tui/component/media-image"
import { ThemeProvider } from "../../src/cli/cmd/tui/context/theme"
import { KeybindProvider } from "../../src/cli/cmd/tui/context/keybind"
import { TuiConfigProvider } from "../../src/cli/cmd/tui/context/tui-config"
import { KVProvider } from "../../src/cli/cmd/tui/context/kv"
import type { TuiConfig } from "../../src/cli/cmd/tui/config/tui"

const defaultConfig: TuiConfig.Info = {
  theme: "opencode",
  scroll_speed: 3,
  diff_style: "auto",
  mouse: true,
  image_protocol: "auto",
  keybinds: {},
}

/** Same provider stack the TUI mounts (see test/cli/tui/dialog-tui-config.test.tsx). */
const Providers = (props: { children: unknown }) => (
  <KVProvider>
    <TuiConfigProvider config={defaultConfig}>
      <KeybindProvider>
        <ThemeProvider mode="dark">{props.children as never}</ThemeProvider>
      </KeybindProvider>
    </TuiConfigProvider>
  </KVProvider>
)

setDefaultTimeout(20_000)

type TestSetup = Awaited<ReturnType<typeof testRender>>
let setup: TestSetup | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

async function whitePngDataUrl(width = 8, height = 8): Promise<string> {
  const png = await sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer()
  return `data:image/png;base64,${png.toString("base64")}`
}

/** Depth-first walk of the renderable tree — the mounted `<image>` is what we assert on. */
function findImages(node: unknown, found: ImageRenderable[] = []): ImageRenderable[] {
  if (node instanceof ImageRenderable) found.push(node)
  const children = (node as { getChildren?: () => unknown[] }).getChildren?.() ?? []
  for (const child of children) findImages(child, found)
  return found
}

/**
 * The test renderer has no terminal, so the capability object is stated explicitly —
 * the same object `MediaImage` reads and the renderable consults. `resolution` stays
 * unset, so the renderable resolves to the block raster and the frame is observable
 * as characters.
 */
function reportSixelTerminal(renderer: unknown, caps: Record<string, unknown>): void {
  const target = renderer as { _capabilities: Record<string, unknown> | null }
  target._capabilities = {
    ...(target._capabilities ?? {}),
    ...caps,
    kitty_graphics: false,
    sixel: true,
    image_protocol: "sixel",
    multiplexer: "none",
  }
}

/** A terminal that answers nothing — the 06:15 dist run (`sixel: false, resolution: null`). */
function reportNoGraphics(renderer: unknown): void {
  const target = renderer as { _capabilities: Record<string, unknown> | null }
  target._capabilities = {
    ...(target._capabilities ?? {}),
    kitty_graphics: false,
    sixel: false,
    image_protocol: "auto",
    multiplexer: "none",
  }
}

describe("MediaImage native branch layout", () => {
  test("native <image> gets a non-zero cell box once the frame is decoded", async () => {
    const url = await whitePngDataUrl()

    setup = await testRender(
      () => (
        <Providers>
          <MediaImage url={url} mime="image/png" />
        </Providers>
      ),
      { width: 40, height: 20 },
    )

    reportSixelTerminal(setup.renderer, {})

    // waitForCapabilities polls for up to 1s, then the decode + mount happen.
    await new Promise((resolve) => setTimeout(resolve, 500))
    await setup.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 200))
    await setup.renderOnce()

    const images = findImages(setup.renderer.root)
    expect(images.length).toBe(1)
    expect(images[0]!.width).toBeGreaterThan(0)
    expect(images[0]!.height).toBeGreaterThan(0)
    // The frame must actually reach the renderable — a mounted <image> with a null
    // source is the exact production symptom (nothing painted, no error state).
    expect(images[0]!.image).not.toBeNull()

    // ...and the pixels must land in the frame the user sees (block raster: the test
    // renderer reports no pixel resolution, so sixel degrades to half-blocks).
    const captured = setup.captureCharFrame()
    expect(/[▀▄█]/.test(captured)).toBe(true)
  })

  test("symbols fallback paints when the terminal reports no graphics protocol", async () => {
    const url = await whitePngDataUrl(24, 24)

    setup = await testRender(
      () => (
        <Providers>
          <MediaImage url={url} mime="image/png" />
        </Providers>
      ),
      { width: 40, height: 20 },
    )

    reportNoGraphics(setup.renderer)

    // mode resolves to "none", so waitForCapabilities burns its full 1s window first.
    await new Promise((resolve) => setTimeout(resolve, 1400))
    await setup.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 200))
    await setup.renderOnce()

    expect(/[▀▄█]/.test(setup.captureCharFrame())).toBe(true)
  })

  test("a late capability answer upgrades the half-block raster to the pixel path", async () => {
    const url = await whitePngDataUrl(24, 24)

    setup = await testRender(
      () => (
        <Providers>
          <MediaImage url={url} mime="image/png" />
        </Providers>
      ),
      { width: 40, height: 20 },
    )

    // The terminal stays silent through the whole probe window — the raster is what it gets.
    reportNoGraphics(setup.renderer)
    await new Promise((resolve) => setTimeout(resolve, 1400))
    await setup.renderOnce()
    expect(findImages(setup.renderer.root).length).toBe(0)

    // ...and only then admits it can paint pixels. Before the fix the mode was read once at
    // mount, so this answer was lost and the image stayed blurry for the element's whole life.
    reportSixelTerminal(setup.renderer, {})
    const lateAnswer = setup.renderer as unknown as { emit: (event: unknown, payload: unknown) => void }
    lateAnswer.emit(CliRenderEvents.CAPABILITIES, (setup.renderer as any).capabilities)

    await new Promise((resolve) => setTimeout(resolve, 800))
    await setup.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 200))
    await setup.renderOnce()

    const images = findImages(setup.renderer.root)
    expect(images.length).toBe(1)
    expect(images[0]!.image).not.toBeNull()
  })
})
