import { describe, expect, test } from "bun:test"
import { detectGraphicsProtocol, detectBestProtocol } from "../../src/util/terminal-graphics"

function withEnv(
  env: Record<string, string | undefined>,
  fn: () => void,
) {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key]
  }
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    fn()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

describe("util.terminal-graphics", () => {
  test("detects kitty via KITTY_WINDOW_ID", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: "1",
        TERM: "xterm-256color",
        TERM_PROGRAM: undefined,
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("kitty")
      },
    )
  })

  test("detects kitty via TERM=xterm-kitty", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: undefined,
        TERM: "xterm-kitty",
        TERM_PROGRAM: undefined,
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("kitty")
      },
    )
  })

  test("detects iterm2 via TERM_PROGRAM=iTerm.app", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: undefined,
        TERM: "xterm-256color",
        TERM_PROGRAM: "iTerm.app",
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("iterm2")
      },
    )
  })

  test("detects wezterm → sixel (widest compat)", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: undefined,
        TERM: "xterm-256color",
        TERM_PROGRAM: "WezTerm",
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("sixel")
      },
    )
  })

  test("detects windows terminal via WT_SESSION → sixel", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: undefined,
        TERM: "xterm-256color",
        TERM_PROGRAM: undefined,
        WT_SESSION: "abc123",
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("sixel")
      },
    )
  })

  test("detects foot terminal → sixel", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: undefined,
        TERM: "xterm-256color",
        TERM_PROGRAM: "foot",
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("sixel")
      },
    )
  })

  test("detects konsole → sixel", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: undefined,
        TERM: "xterm-256color",
        TERM_PROGRAM: "konsole",
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("sixel")
      },
    )
  })

  test("detects xterm → sixel", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: undefined,
        TERM: "xterm-256color",
        TERM_PROGRAM: "xterm",
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("sixel")
      },
    )
  })

  test("detects ghostty → kitty", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: undefined,
        TERM: "xterm-ghostty",
        TERM_PROGRAM: undefined,
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("kitty")
      },
    )
  })

  test("detects vscode → symbols", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: undefined,
        TERM: "xterm-256color",
        TERM_PROGRAM: "vscode",
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("symbols")
      },
    )
  })

  test("falls back to symbols on unknown terminal", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: undefined,
        TERM: "dumb",
        TERM_PROGRAM: undefined,
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("symbols")
      },
    )
  })

  test("falls back to symbols with minimal env", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: undefined,
        TERM: undefined,
        TERM_PROGRAM: undefined,
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("symbols")
      },
    )
  })

  test("KITTY_WINDOW_ID takes priority over TERM_PROGRAM", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: "1",
        TERM: "xterm-256color",
        TERM_PROGRAM: "iTerm.app",
        WT_SESSION: "abc",
      },
      () => {
        expect(detectGraphicsProtocol()).toBe("kitty")
      },
    )
  })

  // ── Override tests ──────────────────────────────────────────────────

  test("override with explicit 'sixel' bypasses detection", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: "1",
        TERM: "xterm-kitty",
        TERM_PROGRAM: undefined,
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol("sixel")).toBe("sixel")
      },
    )
  })

  test("override with 'auto' falls through to detection", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: "1",
        TERM: "xterm-256color",
        TERM_PROGRAM: undefined,
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol("auto")).toBe("kitty")
      },
    )
  })

  test("override with unknown value falls through to detection", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: "1",
        TERM: "xterm-256color",
        TERM_PROGRAM: undefined,
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol("invalid_protocol")).toBe("kitty")
      },
    )
  })

  test("override with 'symbols' on kitty terminal returns symbols", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: "1",
        TERM: "xterm-256color",
        TERM_PROGRAM: undefined,
        WT_SESSION: undefined,
      },
      () => {
        expect(detectGraphicsProtocol("symbols")).toBe("symbols")
      },
    )
  })

  test("detectBestProtocol wraps detectGraphicsProtocol", () => {
    withEnv(
      {
        KITTY_WINDOW_ID: "1",
        TERM: "xterm-256color",
        TERM_PROGRAM: undefined,
        WT_SESSION: undefined,
      },
      () => {
        expect(detectBestProtocol()).toBe("kitty")
        expect(detectBestProtocol("sixel")).toBe("sixel")
        expect(detectBestProtocol("auto")).toBe("kitty")
      },
    )
  })
})
