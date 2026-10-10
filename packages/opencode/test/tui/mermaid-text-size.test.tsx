/** @jsxImportSource @opentui/solid */
import { expect, setDefaultTimeout, test } from "bun:test"
import { ImageRenderable, OptimizedBuffer, ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { MediaMermaid } from "../../src/cli/cmd/tui/component/media-mermaid"
import { ThemeProvider } from "../../src/cli/cmd/tui/context/theme"
import { KeybindProvider } from "../../src/cli/cmd/tui/context/keybind"
import { TuiConfigProvider } from "../../src/cli/cmd/tui/context/tui-config"
import { KVProvider } from "../../src/cli/cmd/tui/context/kv"

setDefaultTimeout(20_000)

function find<T>(node: unknown, kind: new (...args: any[]) => T): T[] {
  return [
    ...(node instanceof kind ? [node] : []),
    ...((node as { getChildren?: () => unknown[] }).getChildren?.() ?? []).flatMap((child) => find(child, kind)),
  ]
}

const wide = "flowchart LR\n" + Array.from({ length: 10 }, (_, i) => `N${i}[MMMM] --> N${i + 1}[MMMM]`).join("\n")

const Providers = (props: { children: any }) => (
  <KVProvider>
    <TuiConfigProvider
      config={{
        theme: "opencode",
        scroll_speed: 3,
        diff_style: "auto",
        mouse: true,
        image_protocol: "auto",
        keybinds: {},
      }}
    >
      <KeybindProvider>
        <ThemeProvider mode="dark">{props.children}</ThemeProvider>
      </KeybindProvider>
    </TuiConfigProvider>
  </KVProvider>
)

test("tall Mermaid scrolls with its parent and exposes following text", async () => {
  const setup = await testRender(
    () => (
      <Providers>
        <scrollbox width="100%" height={20} scrollY={true}>
          <MediaMermaid source={wide.replace("flowchart LR", "flowchart TD")} />
          <text>AFTER DIAGRAM</text>
        </scrollbox>
      </Providers>
    ),
    { width: 40, height: 20, useThread: false },
  )
  const renderer = setup.renderer as any
  renderer._resolution = { width: 480, height: 400 }
  renderer._capabilities = { kitty_graphics: false, sixel: true, image_protocol: "sixel", multiplexer: "none" }
  renderer.renderNative = Object.getPrototypeOf(renderer).renderNative
  try {
    await new Promise((resolve) => setTimeout(resolve, 700))
    await setup.renderOnce()
    await renderer.idle()
    const outer = find(renderer.root, ScrollBoxRenderable)[0]!
    const image = find(renderer.root, ImageRenderable)[0]!
    expect(image.height).toBeGreaterThan(20)
    const pixels = [image.image!.width, image.image!.height]
    await setup.mockMouse.scroll(4, 3, "down", { delayMs: 5 })
    await renderer.idle()
    expect(outer.scrollTop).toBeGreaterThan(0)
    for (let i = 0; i < 200 && outer.scrollTop < outer.scrollHeight - outer.viewport.height; i++) {
      await setup.mockMouse.scroll(4, 3, "down", { delayMs: 5 })
    }
    await renderer.idle()
    expect(setup.captureCharFrame()).toContain("AFTER DIAGRAM")
    expect([image.image!.width, image.image!.height]).toEqual(pixels)
  } finally {
    renderer.destroy()
  }
})

test("Mermaid without graphics publishes visible symbol fallback", async () => {
  const setup = await testRender(
    () => (
      <Providers>
        <MediaMermaid source="flowchart TD\n A[MMMM] --> B[MMMM]" />
      </Providers>
    ),
    { width: 40, height: 30 },
  )
  const renderer = setup.renderer as any
  renderer._capabilities = { kitty_graphics: false, sixel: false, image_protocol: "none", multiplexer: "none" }
  try {
    let frame = ""
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      await setup.renderOnce()
      frame = setup.captureCharFrame()
      if (/[\u2580-\u259f]/.test(frame)) break
    }
    expect(frame).toMatch(/[\u2580-\u259f]/)
    expect(find(renderer.root, ImageRenderable)).toHaveLength(0)
  } finally {
    renderer.destroy()
  }
})

test("wide Mermaid scrolls horizontally without resizing its source pixels", async () => {
  const dimensions: number[] = []
  for (const width of [40, 80]) {
    const setup = await testRender(
      () => (
        <KVProvider>
          <TuiConfigProvider
            config={{
              theme: "opencode",
              scroll_speed: 3,
              diff_style: "auto",
              mouse: true,
              image_protocol: "auto",
              keybinds: {},
            }}
          >
            <KeybindProvider>
              <ThemeProvider mode="dark">
                <MediaMermaid source={wide} />
              </ThemeProvider>
            </KeybindProvider>
          </TuiConfigProvider>
        </KVProvider>
      ),
      { width, height: 30, useMouse: true, useThread: false },
    )
    const renderer = setup.renderer as unknown as {
      _resolution: { width: number; height: number }
      _capabilities: object | null
    }
    renderer._resolution = { width: width * 12, height: 600 }
    renderer._capabilities = { kitty_graphics: false, sixel: true, image_protocol: "sixel", multiplexer: "none" }
    // Restore the real memory-backed native renderer disabled by test preload.
    const native = setup.renderer as unknown as { renderNative: () => unknown }
    native.renderNative = Object.getPrototypeOf(setup.renderer).renderNative
    setup.renderer.useMouse = false
    setup.renderer.useMouse = true
    const calls: number[][] = []
    const draw = OptimizedBuffer.prototype.drawImage
    OptimizedBuffer.prototype.drawImage = function (...args: Parameters<typeof draw>) {
      calls.push([args[5] ?? 0, args[6] ?? 0])
      return draw.apply(this, args)
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 700))
      setup.renderer.useMouse = true
      await setup.renderOnce()
      await setup.renderer.idle()
      const image = find(setup.renderer.root, ImageRenderable)[0]!
      const scroll = find(setup.renderer.root, ScrollBoxRenderable)[0]!
      expect(image).toBeDefined()
      expect(scroll).toBeDefined()
      expect(image.image).not.toBeNull()
      dimensions.push(image.image!.width)
      expect(image.width).toBeGreaterThan(scroll.viewport.width)
      expect(scroll.viewport.width).toBeLessThanOrEqual(width)
      expect(calls).toContainEqual([image.image!.width, image.image!.height])
      expect(scroll.scrollWidth).toBe(image.width)
      expect(setup.renderer.hitTest(scroll.viewport.x + 1, scroll.viewport.y + 1)).toBeGreaterThan(0)
      await setup.mockMouse.scroll(scroll.viewport.x + 1, scroll.viewport.y + 1, "right", { delayMs: 5 })
      await setup.renderOnce()
      expect(scroll.scrollLeft).toBeGreaterThan(0)
      for (let i = 0; i < 200 && scroll.scrollLeft < scroll.scrollWidth - scroll.viewport.width; i++) {
        await setup.mockMouse.scroll(scroll.viewport.x + 1, scroll.viewport.y + 1, "right", { delayMs: 5 })
      }
      await setup.renderOnce()
      expect(scroll.scrollLeft).toBe(scroll.scrollWidth - scroll.viewport.width)
      expect(image.x + image.width).toBeLessThanOrEqual(scroll.viewport.x + scroll.viewport.width)
      expect(calls.every(([w, h]) => w === image.image!.width && h === image.image!.height)).toBe(true)
    } finally {
      OptimizedBuffer.prototype.drawImage = draw
      setup.renderer.destroy()
    }
  }
  expect(dimensions[0]).toBe(dimensions[1])
})
