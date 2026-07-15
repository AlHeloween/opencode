/**
 * Terminal image rendering dispatch.
 * Detects the best available graphics protocol and renders an image file
 * directly to terminal escape sequences — no WebGPU, no Three.js.
 *
 * Protocols supported:
 *   - sixel  → sixelImage()  (Windows Terminal, foot, Konsole, xterm-sixel)
 *   - kitty  → kittyImage()  (Kitty, WezTerm, Ghostty)
 *   - symbols → imageToAnsi() (any TrueColor terminal)
 *
 * Pipeline: image file → Jimp decode → protocol-specific escape sequence → terminal
 */
import { sixelImage } from "./sixel-render"
import { kittyImage } from "./kitty-render"
import { imageToAnsi, imageToChunks, type AnsiChunk } from "./image-to-ansi"
import { detectBestProtocol, type GraphicsProtocol } from "./terminal-graphics"
import { sixelHeightInRows } from "./terminal-write"
import { writeFileSync, unlinkSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "util.render-image-to-terminal" })

export interface RenderOptions {
  imagePath: string
  maxCols?: number
  protocol?: GraphicsProtocol | "auto"
  /** When false, don't write to stdout — caller handles positioning. Default: true. */
  writeToTerminal?: boolean
}

export type RenderResult = {
  escapeSequence: string     // The raw escape sequence to write (empty for symbols)
  protocol: GraphicsProtocol // Which protocol was used
  dimensions: { cols: number; rows: number; terminalRows: number }  // terminalRows = rows in terminal cells
  chunks?: AnsiChunk[][]     // Inline chunks for symbols protocol (no terminal write needed)
}

/**
 * Render an image file to terminal escape sequences using the best
 * available graphics protocol. Returns the escape sequence string
 * that the caller should write to the terminal.
 */
export async function renderImageToTerminal(
  options: RenderOptions,
): Promise<RenderResult> {
  const { imagePath, maxCols = 80 } = options
  const protocol = options.protocol === "auto" || !options.protocol
    ? detectBestProtocol()
    : options.protocol

  log.debug("rendering image to terminal", {
    protocol,
    imagePath,
    maxCols,
  })

  switch (protocol) {
    case "kitty":
      return {
        escapeSequence: await kittyImage(imagePath, maxCols),
        protocol: "kitty",
        dimensions: { cols: maxCols, rows: Math.round(maxCols * 0.75), terminalRows: 0 },
      }

    case "sixel": {
      const result = await sixelImage(imagePath, { maxCols })
      // Calculate terminal rows from sixel pixel height
      // sixelImage internally rounds rows up to multiple of 6
      const pixelHeight = Math.round(maxCols / (imageAspect(imagePath) || 1.5))
      return {
        escapeSequence: result,
        protocol: "sixel",
        dimensions: { cols: maxCols, rows: pixelHeight, terminalRows: sixelHeightInRows(pixelHeight) },
      }
    }

    case "iterm2":
      // iTerm2 protocol: \x1b]1337;File=;size=<bytes>;width=<px>:<base64>\x07
      log.warn("bug: iterm2 protocol not yet implemented, falling back to symbols")
      return renderAsAnsi(imagePath, maxCols)

    case "symbols":
    default:
      return renderAsAnsi(imagePath, maxCols)
  }
}

/** 
 *  Render a base64 data URL to terminal using the best available protocol.
 *  Saves to temp file, renders, cleans up.
 * 
 *  Uses the full renderImageToTerminal protocol chain:
 *    kitty → sixel → symbols (Jimp half-block, pure CPU).
 *  No WebGPU / Three.js dependency — works on every TrueColor terminal.
 *
 *  Returns the render result with terminal row count for TUI placeholder sizing,
 *  and the escape sequence that should be written to the terminal.
 */
export async function renderDataUrlToTerminal(
  dataUrl: string,
  options?: { maxCols?: number; protocol?: GraphicsProtocol | "auto"; writeToTerminal?: boolean },
): Promise<RenderResult | null> {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!match) return null

  const [, ext, base64] = match
  const extName = ext === "jpeg" ? ".jpg" : ".png"
  const tmpFile = join(
    tmpdir(),
    `opencode_gfx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${extName}`,
  )

  try {
    writeFileSync(tmpFile, Buffer.from(base64!, "base64"))
    const cols = options?.maxCols ?? 60
    const protocol = options?.protocol ?? "auto"
    const write = options?.writeToTerminal ?? true
    const result = await renderImageToTerminal({ imagePath: tmpFile, maxCols: cols, protocol })
    // Only write to terminal for protocols that use escape sequences (sixel, kitty).
    // Symbols protocol returns chunks for inline TUI rendering — no terminal write.
    // When writeToTerminal is false, caller handles positioning + write.
    if (result.escapeSequence && write) {
      process.stdout.write(result.escapeSequence)
    }
    return result
  } catch (err) {
    log.warn("bug: renderDataUrlToTerminal failed", { error: String(err) })
    return null
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile) } catch {}
  }
}

async function renderAsAnsi(
  imagePath: string,
  maxCols: number,
): Promise<RenderResult> {
  const chunks = await imageToChunks(imagePath, { width: maxCols })
  return {
    escapeSequence: "",
    protocol: "symbols",
    dimensions: { cols: maxCols, rows: chunks.length, terminalRows: chunks.length },
    chunks,
  }
}

/** Quick aspect ratio from a file path string (no IO). */
function imageAspect(imagePath: string): number | null {
  // Could extract from PNG header, but for now just return null
  return null
}

export { sixelHeightInRows }
