import Chafa from "chafa-wasm"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "util.chafa-wasm-render" })

// ---------------------------------------------------------------------------
// Lazy singleton — Chafa WASM module initialised once
// ---------------------------------------------------------------------------

let chafaInstance: Awaited<ReturnType<typeof Chafa>> | null = null

async function getChafa() {
  if (!chafaInstance) {
    log.debug("initialising chafa-wasm singleton")
    chafaInstance = await Chafa()
    log.debug("chafa-wasm singleton ready", {
      pixelModes: Object.keys(chafaInstance.ChafaPixelMode),
    })
  }
  return chafaInstance
}

// ---------------------------------------------------------------------------
// Protocol priority ordered best → fallback
// ---------------------------------------------------------------------------

export const GRAPHICS_PROTOCOL_PRIORITY = [
  "kitty",
  "sixel",
  "iterm2",
  "symbols",
] as const

export type GraphicsProtocol = (typeof GRAPHICS_PROTOCOL_PRIORITY)[number]

// ---------------------------------------------------------------------------
// Build chafa config — shared across Mermaid and image rendering
// ---------------------------------------------------------------------------

export interface ChafaRenderConfig {
  format: number // ChafaPixelMode value
  width: number
  height: number
  symbols?: string
  preprocess?: boolean
  threshold?: number
}

export function buildChafaConfig(
  chafa: Awaited<ReturnType<typeof Chafa>>,
  overrides: Partial<ChafaRenderConfig>,
): Record<string, unknown> {
  return {
    format: overrides.format ?? chafa.ChafaPixelMode.CHAFA_PIXEL_MODE_SYMBOLS.value,
    height: overrides.height ?? 24,
    width: overrides.width ?? 80,
    colors: chafa.ChafaCanvasMode.CHAFA_CANVAS_MODE_TRUECOLOR.value,
    colorSpace: chafa.ChafaColorSpace.CHAFA_COLOR_SPACE_RGB.value,
    symbols: overrides.symbols ?? "block+border+space-wide-inverted",
    preprocess: overrides.preprocess ?? true,
    threshold: overrides.threshold ?? 0.5,
  }
}

// ---------------------------------------------------------------------------
// Render image buffer → terminal output via chafa-wasm
// ---------------------------------------------------------------------------

export async function renderImageToTerminal(
  imageBuffer: ArrayBuffer,
  config: Partial<ChafaRenderConfig> & { protocol?: GraphicsProtocol },
): Promise<string | null> {
  const chafa = await getChafa()

  // Resolve pixel mode from protocol name
  const pixelMode = protocolToPixelMode(chafa, config.protocol ?? "symbols")
  const formatValue = pixelMode.value

  const fullConfig = buildChafaConfig(chafa, {
    ...config,
    format: formatValue,
  })

  const protocolName = pixelModeToProtocolName(chafa, pixelMode)
  log.debug("rendering image to terminal", {
    protocol: protocolName,
    format: formatValue,
    width: fullConfig.width,
    height: fullConfig.height,
    imageBytes: imageBuffer.byteLength,
  })

  // chafa-wasm imageToAnsi is callback-based: (buffer, options, callback)
  // where callback is (error, { ansi }). Promisify explicitly.
  const ansi = await new Promise<string>((resolve, reject) => {
    chafa.imageToAnsi(imageBuffer, fullConfig, (err: unknown, result: { ansi: string }) => {
      if (err) {
        reject(err)
        return
      }
      resolve(result.ansi)
    })
  })

  if (!ansi || ansi.length === 0) {
    log.warn("bug: chafa-wasm produced empty output", {
      protocol: protocolName,
      imageBytes: imageBuffer.byteLength,
    })
    return null
  }

  log.debug("chafa-wasm render success", {
    protocol: protocolName,
    outputLength: ansi.length,
  })
  return ansi
}

// ---------------------------------------------------------------------------
// Protocol ↔ PixelMode conversion
// ---------------------------------------------------------------------------

function protocolToPixelMode(
  chafa: Awaited<ReturnType<typeof Chafa>>,
  protocol: GraphicsProtocol,
) {
  switch (protocol) {
    case "kitty":
      return chafa.ChafaPixelMode.CHAFA_PIXEL_MODE_KITTY
    case "sixel":
      return chafa.ChafaPixelMode.CHAFA_PIXEL_MODE_SIXELS
    case "iterm2":
      return chafa.ChafaPixelMode.CHAFA_PIXEL_MODE_ITERM2
    case "symbols":
    default:
      return chafa.ChafaPixelMode.CHAFA_PIXEL_MODE_SYMBOLS
  }
}

function pixelModeToProtocolName(
  chafa: Awaited<ReturnType<typeof Chafa>>,
  mode: { value: number },
): string {
  const m = chafa.ChafaPixelMode
  if (mode.value === m.CHAFA_PIXEL_MODE_KITTY.value) return "kitty"
  if (mode.value === m.CHAFA_PIXEL_MODE_SIXELS.value) return "sixel"
  if (mode.value === m.CHAFA_PIXEL_MODE_ITERM2.value) return "iterm2"
  if (mode.value === m.CHAFA_PIXEL_MODE_SYMBOLS.value) return "symbols"
  return `unknown(${mode.value})`
}

// ---------------------------------------------------------------------------
// Expose getChafa for direct access (used by Mermaid pipeline and tests)
// ---------------------------------------------------------------------------

export { getChafa }
