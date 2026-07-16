/**
 * Integration tests: MediaImage fallback chain
 * ============================================================================
 * Verifies protocol decision logic, config override, and symbolic fallback.
 * These test the logic in media-image.tsx without mounting the full TUI.
 */
import { describe, expect, test } from "bun:test"
import { detectBestProtocol, detectGraphicsProtocol } from "../../src/util/terminal-graphics"

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(env)) saved[key] = process.env[key]
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fn()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

// Replicate the decision logic from media-image.tsx
function isGraphicsProtocol(p: string): boolean {
  return p === "kitty" || p === "sixel" || p === "iterm2"
}

function chooseRenderer(protocolOverride?: string): { use3D: boolean; protocol: string } {
  const protocol = detectBestProtocol(protocolOverride)
  return { use3D: isGraphicsProtocol(protocol), protocol }
}

describe("MediaImage fallback chain", () => {
  test("WezTerm → use3D=true", () => {
    withEnv({ KITTY_WINDOW_ID: undefined, TERM: "xterm-256color", TERM_PROGRAM: "WezTerm", WT_SESSION: undefined }, () => {
      const { use3D, protocol } = chooseRenderer()
      expect(protocol).toBe("kitty")
      expect(use3D).toBe(true)
    })
  })

  test("Windows Terminal → use3D=true", () => {
    withEnv({ KITTY_WINDOW_ID: undefined, TERM: "xterm-256color", TERM_PROGRAM: undefined, WT_SESSION: "abc" }, () => {
      const { use3D, protocol } = chooseRenderer()
      expect(protocol).toBe("sixel")
      expect(use3D).toBe(true)
    })
  })

  test("iTerm2 → use3D=true", () => {
    withEnv({ KITTY_WINDOW_ID: undefined, TERM: "xterm-256color", TERM_PROGRAM: "iTerm.app", WT_SESSION: undefined }, () => {
      const { use3D, protocol } = chooseRenderer()
      expect(protocol).toBe("iterm2")
      expect(use3D).toBe(true)
    })
  })

  test("unknown terminal → default Sixel (use3D=true)", () => {
    // detectGraphicsProtocol defaults unknown TERM (including "dumb") to Sixel;
    // MediaImage still has an explicit symbols fallback if the render fails.
    withEnv({ KITTY_WINDOW_ID: undefined, TERM: "dumb", TERM_PROGRAM: undefined, WT_SESSION: undefined }, () => {
      const { use3D, protocol } = chooseRenderer()
      expect(protocol).toBe("sixel")
      expect(use3D).toBe(true)
    })
  })

  test("VS Code terminal → use3D=false", () => {
    withEnv({ KITTY_WINDOW_ID: undefined, TERM: "xterm-256color", TERM_PROGRAM: "vscode", WT_SESSION: undefined }, () => {
      const { use3D, protocol } = chooseRenderer()
      expect(protocol).toBe("symbols")
      expect(use3D).toBe(false)
    })
  })

  test("override: force symbols on WezTerm", () => {
    withEnv({ KITTY_WINDOW_ID: undefined, TERM: "xterm-256color", TERM_PROGRAM: "WezTerm", WT_SESSION: undefined }, () => {
      const { use3D, protocol } = chooseRenderer("symbols")
      expect(protocol).toBe("symbols")
      expect(use3D).toBe(false)
    })
  })

  test("override: force sixel on VSCode", () => {
    withEnv({ KITTY_WINDOW_ID: undefined, TERM: "xterm-256color", TERM_PROGRAM: "vscode", WT_SESSION: undefined }, () => {
      const { use3D, protocol } = chooseRenderer("sixel")
      expect(protocol).toBe("sixel")
      expect(use3D).toBe(true)
    })
  })

  test("protocol symbols is not graphics protocol", () => {
    expect(isGraphicsProtocol("symbols")).toBe(false)
  })

  test("protocol kitty/sixel/iterm2 are graphics protocols", () => {
    expect(isGraphicsProtocol("kitty")).toBe(true)
    expect(isGraphicsProtocol("sixel")).toBe(true)
    expect(isGraphicsProtocol("iterm2")).toBe(true)
  })
})
