import * as Log from "@opencode-ai/core/util/log"
import { GRAPHICS_PROTOCOL_PRIORITY, type GraphicsProtocol } from "@/util/chafa-wasm-render"

const log = Log.create({ service: "util.terminal-graphics" })

function isGraphicsProtocol(value: string): value is GraphicsProtocol {
  return (GRAPHICS_PROTOCOL_PRIORITY as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Detect the best terminal graphics protocol available in this terminal.
// Accepts an optional explicit override (e.g. from tui.json image_protocol).
// Returns the protocol name to pass to renderImageToTerminal().
// No silent fallback — every branch is logged.
// ---------------------------------------------------------------------------

export function detectGraphicsProtocol(override?: string): GraphicsProtocol {
  // ── Explicit override from tui.json ────────────────────────────────
  if (override && override !== "auto") {
    if (isGraphicsProtocol(override)) {
      log.debug("using explicit image_protocol from config", { protocol: override })
      return override
    }
    log.warn("bug: unknown image_protocol in config", { protocol: override })
  }

  const term = process.env["TERM"] ?? ""
  const termProgram = process.env["TERM_PROGRAM"] ?? ""
  const kittyWindowId = process.env["KITTY_WINDOW_ID"]
  const wtSession = process.env["WT_SESSION"]

  log.debug("detecting terminal graphics protocol", {
    TERM: term,
    TERM_PROGRAM: termProgram,
    KITTY_WINDOW_ID: kittyWindowId ? "<present>" : "<absent>",
    WT_SESSION: wtSession ? "<present>" : "<absent>",
    override: override ?? "auto",
  })

  // ── Kitty ───────────────────────────────────────────────────────────
  if (kittyWindowId) {
    log.debug("detected Kitty via KITTY_WINDOW_ID")
    return "kitty"
  }
  if (term === "xterm-kitty" || term.startsWith("kitty")) {
    log.debug("detected Kitty via TERM", { TERM: term })
    return "kitty"
  }

  // ── iTerm2 ──────────────────────────────────────────────────────────
  if (termProgram === "iTerm.app") {
    log.debug("detected iTerm2 via TERM_PROGRAM")
    return "iterm2"
  }
  if (termProgram === "WezTerm") {
    // WezTerm supports all three graphics protocols.
    // Prefer Kitty (24-bit, animation) — requires enable_kitty_graphics=true in wezterm.lua.
    // Falls back through the render chain: Kitty → symbols → binary chafa if not enabled.
    log.debug("WezTerm detected — preferring Kitty protocol (enable_kitty_graphics=true in wezterm.lua)")
    return "kitty"
  }

  // ── Sixel ───────────────────────────────────────────────────────────
  // Windows Terminal: WT_SESSION + supports Sixel since ~2024
  if (wtSession) {
    log.debug("detected Windows Terminal via WT_SESSION — Sixel supported")
    return "sixel"
  }

  // Ghostty: Kitty protocol — check BEFORE generic xterm
  if (term === "xterm-ghostty") {
    log.debug("detected Ghostty — Kitty supported")
    return "kitty"
  }

  // ── VS Code / IDE terminals — no graphics protocol support ──────────
  if (termProgram === "vscode") {
    log.debug("VS Code terminal — no graphics protocol, falling back to symbols")
    return "symbols"
  }

  // foot terminal: supports Sixel
  if (termProgram === "foot") {
    log.debug("detected foot terminal — Sixel supported")
    return "sixel"
  }

  // Konsole: supports Sixel + Kitty
  if (termProgram === "konsole") {
    log.debug("detected Konsole — preferring sixel (wider compat)")
    return "sixel"
  }

  // Generic xterm with Sixel patch available (must be AFTER ghostty/vscode)
  if (termProgram === "xterm" || term.startsWith("xterm")) {
    log.debug("xterm detected — Sixel may be available")
    return "sixel"
  }

  // ── Symbols fallback — always works, always logged ──────────────────
  log.debug("no graphics protocol detected — falling back to Unicode symbols", {
    TERM: term || "<unset>",
    TERM_PROGRAM: termProgram || "<unset>",
  })
  return "symbols"
}

// ---------------------------------------------------------------------------
// Try protocols in priority order, returning the first that should work.
// The caller still needs to handle render failures (the protocol may be
// detected but the terminal doesn't actually support it).
// ---------------------------------------------------------------------------

export function detectBestProtocol(override?: string): GraphicsProtocol {
  const detected = detectGraphicsProtocol(override)
  log.debug("best terminal graphics protocol", { protocol: detected })
  return detected
}
