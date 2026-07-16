/**
 * Terminal device writer — write raw bytes directly to the terminal,
 * bypassing stdout/TUI render buffer.
 *
 * On Windows: opens \\.\CON (console input/output device)
 * On Unix:    opens /dev/tty (controlling terminal)
 *
 * The file descriptor is cached after first open for performance.
 */
import { openSync, writeSync, closeSync } from "fs"
import { platform } from "os"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "util.terminal-write" })

let terminalFd: number | null = null

function getTerminalDevice(): string {
  switch (platform()) {
    case "win32":  return "CON"
    case "darwin":
    case "linux":  return "/dev/tty"
    default:       throw new Error(`Unsupported platform: ${platform()}`)
  }
}

/**
 * Open the terminal device for raw writing.
 * Returns the file descriptor (cached after first open).
 */
function ensureOpen(): number {
  if (terminalFd === null) {
    const device = getTerminalDevice()
    log.debug(`opening terminal device: ${device}`)
    terminalFd = openSync(device, "w")
  }
  return terminalFd
}

/**
 * Write raw bytes directly to the terminal device.
 * Bypasses stdout/TUI render buffer entirely.
 * @param data — string or Buffer to write
 */
export function writeToTerminal(data: string | Buffer): void {
  const fd = ensureOpen()
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data
  writeSync(fd, buf)
}

/**
 * Calculate the approximate height in terminal rows that a Sixel image
 * of the given pixel height will occupy.
 *
 * Sixel groups 6 vertical pixels per scan line. Each scan line advances
 * one terminal row. So ceil(pixelHeight / 6) ≈ terminal rows.
 */
export function sixelHeightInRows(pixelHeight: number): number {
  return Math.max(1, Math.ceil(pixelHeight / 6))
}

/**
 * Clean up the cached terminal file descriptor.
 * Should be called during shutdown.
 */
export function closeTerminal(): void {
  if (terminalFd !== null) {
    try {
      closeSync(terminalFd)
    } catch (err) {
      // Expected if the device was already closed by the OS / process teardown.
      log.debug("closeTerminal: closeSync failed", { error: String(err) })
    }
    terminalFd = null
  }
}

export * as TerminalWrite from "./terminal-write"
