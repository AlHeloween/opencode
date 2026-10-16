import { describe, expect, test } from "bun:test"
import { agentRowModelCell } from "../../src/cli/cmd/tui/component/agent-model-cell"
import { capabilityGlyphs } from "../../src/cli/cmd/tui/component/model-cost"

// t75 — staircase in the Claude Desktop Terminal panel (plans/2026-10-16_tui-render-claude-panel.md).
//
// Measured (run 20261016T115903Z_2a9aa77f, exit 0):
//   eye-plain U+1F441 — Bun.stringWidth 1, string-width lib 2, native eawToWidth 1
//     (utf8.zig: eawToWidth falls through to `return 1`; U+1F441 sits in the gap
//     between 1F400-1F43E, single 1F440, and 1F442-1F4FC).
//   eye-vs16 U+1F441 U+FE0F — Bun 2, lib 2, native cluster 2
//     (utf8.zig addCodepoint: VS16 promotes a width-1 cluster to 2).
// Every other badge glyph agrees on all three sides (camera/brain/wrench 2, arrows/dot 1).
// The panel renders the eye emoji-style (2 cells) while our layout reserves 1 cell,
// so every badge row is one cell wider on the panel than in our buffer — the overflow
// that cascades into the visible staircase (TERM_PROGRAM=claude-desktop matches no
// explicit_cursor_positioning rule in terminal.zig, so intra-row bytes after the eye
// rely on the terminal's own advance).

const EYE_VS16 = "👁️"
const FULL_CAPS = { reasoning: true, toolcall: true, input: { image: true, video: true } }

describe("t75 badge eye carries VS16 so all width tables agree", () => {
  test("capability glyphs request emoji presentation for the eye", () => {
    expect(capabilityGlyphs(FULL_CAPS)).toContain(EYE_VS16)
  })

  test("the full badge is exactly the VS16 form at 13 cells", () => {
    const badge = capabilityGlyphs(FULL_CAPS)
    // Exact contract: the eye carries VS16, so Bun, the string-width lib, the native
    // grapheme cluster (utf8.zig VS16 promotion) and an emoji panel all count the eye
    // as 2 and the badge as 13: 1+2+1+2+1+2+1+2+1. The pre-fix badge counts 12 on our
    // side (plain eye = 1 everywhere: standalone and in-badge alike — runs
    // 20261016T115903Z_2a9aa77f and 20261016T120500Z_531eea36) while an emoji panel
    // needs 13, which is the per-row overflow. Explicit presentation, never guessed.
    expect(badge).toBe(`[🎥 ${EYE_VS16} 🧠 🔧]`)
    expect(Bun.stringWidth(badge!)).toBe(13)
  })

  test("stacked agent footers do not overflow the laid-out row on an emoji panel", () => {
    // Panel model: every glyph advances as Bun counts it, except the eye which an
    // emoji-style panel advances as 2. A row overflows when the panel needs more
    // cells than our layout reserved — each overflowing badge row wraps and the
    // wrapped tails cascade into the staircase.
    const panelWidth = (text: string): number =>
      Bun.stringWidth(text) + (text.includes("👁") && !text.includes(EYE_VS16) ? 1 : 0)
    const rows = ["build_mode", "plan_mode", "orchestrator_agent", "reasoning_mode", "explore"].map(
      (name) =>
        agentRowModelCell({
          ref: "test/model",
          provider: { id: "test", name: "Test" },
          info: { name: "Model", capabilities: FULL_CAPS },
          variant: undefined,
        }).footer + ` #${name}`,
    )
    for (const row of rows) {
      expect(panelWidth(row)).toBeLessThanOrEqual(Bun.stringWidth(row))
    }
  })
})
