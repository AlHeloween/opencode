/** @jsxImportSource @opentui/solid */
/**
 * T10 of plans/to_be_confirmed/2026-09-22_reasoning-stream-render-stability.md — one zoom step publishes ONE frame.
 *
 * `pushFrame` used to hand the same frame over twice: `setFrame` re-runs the frame effect, which calls
 * `setImage`, and the function then called `setImage` directly as well. Each call builds a new
 * NativeImage, so every wheel tick paid two native images and a sixel re-encode per publication.
 * The predicate counts `setImage` calls per wheel step on the REAL component; the control is the
 * mount itself, which must publish exactly once.
 */
import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { ImageRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
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

function findImages(node: unknown, found: ImageRenderable[] = []): ImageRenderable[] {
  if (node instanceof ImageRenderable) found.push(node)
  const children = (node as { getChildren?: () => unknown[] }).getChildren?.() ?? []
  for (const child of children) findImages(child, found)
  return found
}

function checkerboard(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const on = (i % width) % 2 === Math.floor(i / width) % 2
    data.set(on ? [255, 255, 255, 255] : [0, 0, 0, 255], i * 4)
  }
  return data
}

test("one wheel zoom step publishes one frame to the native image (T10)", async () => {
  // Pass-through observation of the one entry point every publication goes through.
  const calls: number[] = []
  const setImage = ImageRenderable.prototype.setImage
  ImageRenderable.prototype.setImage = function (this: ImageRenderable, ...args: Parameters<typeof setImage>) {
    calls.push(args[1])
    return setImage.apply(this, args)
  }

  try {
    const frame = { data: checkerboard(48, 40), width: 48, height: 40 }
    setup = await testRender(
      () => (
        <Providers>
          <MediaImage mime="image/png" layout="diagram" interactive renderNative={async () => frame} />
        </Providers>
      ),
      { width: 40, height: 20 },
    )
    const target = setup.renderer as unknown as { _capabilities: Record<string, unknown> | null }
    target._capabilities = {
      ...(target._capabilities ?? {}),
      kitty_graphics: false,
      sixel: true,
      image_protocol: "sixel",
      multiplexer: "none",
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
    await setup.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 100))
    await setup.renderOnce()

    const images = findImages(setup.renderer.root)
    expect(images.length).toBe(1)
    const mounted = calls.length
    // Control: the mount publishes exactly once (the ref callback).
    expect(mounted).toBe(1)

    const image = images[0]!
    await setup.mockMouse.scroll(image.x + 1, image.y + 1, "up")
    await setup.renderOnce()

    // The zoom step really happened (otherwise the count below would read 0 for the wrong reason)...
    expect(calls.length).toBeGreaterThan(mounted)
    // ...and it cost exactly one publication.
    expect(calls.length - mounted).toBe(1)
  } finally {
    ImageRenderable.prototype.setImage = setImage
  }
})
