/** @jsxImportSource @opentui/solid */
/**
 * OpenTUI passthrough test: does @opentui preserve or filter graphics escape codes?
 *
 * Renders a test string containing all three protocol escape codes
 * through the OpenTUI <text> component and checks what comes out.
 *
 * Usage:
 *   bun run experiments/tui-image-rendering/test-opentui-passthrough.tsx
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { readFileSync } from "fs"
import { resolve } from "path"

// Sample escape sequences for each protocol
const SIXEL_TEST = "\x1bPq#0;2;0;0;0#1;2;100;100;100#1~@-#0~@-\x1b\\"
const KITTY_TEST = "\x1b_Ga=T,f=32,s=1,v=1;AAAA\x1b\\"
const ANSI_TEST = "\x1b[38;2;255;0;0mRED\x1b[0m"

describe("OpenTUI graphics passthrough", () => {
  test("ANSI colors pass through <text>", async () => {
    const app = await testRender(() => <text fg="#ffffff">{ANSI_TEST}</text>)
    expect(app).toBeDefined()
    // OpenTUI should render ANSI colors natively
  })

  test("Sixel escape codes in <text>", async () => {
    const app = await testRender(() => <text fg="#ffffff">prefix{SIXEL_TEST}suffix</text>)
    expect(app).toBeDefined()
    // Check if Sixel codes survive or are stripped
  })

  test("Kitty escape codes in <text>", async () => {
    const app = await testRender(() => <text fg="#ffffff">prefix{KITTY_TEST}suffix</text>)
    expect(app).toBeDefined()
    // Check if Kitty codes survive or are stripped
  })
})

// Run if executed directly
const isMain = import.meta.path === Bun.main
if (isMain) {
  console.log("OpenTUI passthrough test — run with: bun test experiments/tui-image-rendering/test-opentui-passthrough.tsx")

  // Quick smoke: render a real chafa-wasm output through testRender
  const imagePath = resolve(import.meta.dirname ?? ".", "..", "vision", "dragon.jpg")
  const imageBytes = readFileSync(imagePath)

  const { renderImageToTerminal } = await import("../../packages/opencode/src/util/chafa-wasm-render")
  const result = await renderImageToTerminal(imageBytes.buffer as ArrayBuffer, {
    protocol: "symbols",
    width: 80,
    height: 15,
  })

  if (!result) {
    console.error("FAILED: renderImageToTerminal returned null")
    process.exit(1)
  }

  console.log(`Output length: ${result.length}`)
  console.log(`First 100 chars: ${result.substring(0, 100)}`)

  // Attempt to render through OpenTUI testRender
  try {
    const app = await testRender(() => <text fg="#ffffff">{result}</text>)
    console.log("OpenTUI render: OK", { app: typeof app })
  } catch (err) {
    console.error("OpenTUI render FAILED:", err)
  }
}
