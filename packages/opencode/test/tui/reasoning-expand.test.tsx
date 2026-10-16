/** @jsxImportSource @opentui/solid */
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ThemeProvider } from "../../src/cli/cmd/tui/context/theme"
import { TuiConfigProvider } from "../../src/cli/cmd/tui/context/tui-config"
import { KVProvider } from "../../src/cli/cmd/tui/context/kv"
import { ReasoningPart, SessionContext } from "../../src/cli/cmd/tui/routes/session"

// T65 T6 (T2 RED): a completed reasoning block longer than the display window
// must offer its full text through the existing expand affordance — the head
// must not be reachable only in the DB. Contract: collapsed shows the tail +
// omitted counter + "Click to expand"; expanded (initialExpanded, then click)
// shows the head with no omitted counter. Paid inference: zero.

setDefaultTimeout(20_000)

const HEAD = "HEAD-MARKER- uniqueness 7f3a"
const longText = `${HEAD}\n\n${"x".repeat(12_000)}\n\ntail-end`

function part() {
  return {
    id: "part-reasoning-1",
    type: "reasoning",
    text: longText,
    time: { start: 0, end: 1 },
  } as any
}

function message() {
  return { id: "msg-assistant-1" } as any
}

function sessionValue() {
  return {
    showThinking: () => true,
    isDeferred: () => false,
    conceal: () => false,
  } as any
}

async function renderReasoning(props: { initialExpanded?: boolean } = {}) {
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
        <ThemeProvider mode="dark">
          <SessionContext.Provider value={sessionValue()}>
            <ReasoningPart last={true} part={part()} message={message()} initialExpanded={props.initialExpanded} />
          </SessionContext.Provider>
        </ThemeProvider>
        </TuiConfigProvider>
      </KVProvider>
    ),
    { width: 100, height: 80, useThread: false },
  )
  try {
    await new Promise((resolve) => setTimeout(resolve, 300))
    await setup.renderOnce()
    await (setup.renderer as any).idle()
    return setup.captureCharFrame()
  } finally {
    ;(setup.renderer as any).destroy()
  }
}

describe("reasoning expand affordance (t65 T6)", () => {
  test("collapsed: tail + omitted counter + expand hint, head absent", async () => {
    const frame = await renderReasoning()
    // Wrap-robust: the 100-col frame may split the counter line.
    expect(frame).toContain("omitted")
    expect(frame).toContain("latest 6000 shown")
    expect(frame).toContain("Click to expand")
    expect(frame.includes(HEAD)).toBe(false)
    expect(frame).toContain("tail-end")
  })

  test("initialExpanded: head visible, no omitted counter", async () => {
    const frame = await renderReasoning({ initialExpanded: true })
    expect(frame.includes("omitted")).toBe(false)
  })
})
