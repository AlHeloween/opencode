/**
 * Sixel Direct Terminal Test — writes Sixel escape sequence directly
 * to the terminal device file, bypassing stdout/TUI renderer.
 *
 * On Windows: writes to \\.\CON (the console input/output device)
 * On Unix:    writes to /dev/tty (the controlling terminal)
 *
 * Usage: bun run sixel_terminal.ts
 */

import { openSync, writeSync, closeSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { platform } from "os"

const DIR = dirname(fileURLToPath(import.meta.url))
const SIXEL_FILE = join(DIR, "sixel_output.txt")

function getTerminalDevice(): string {
  switch (platform()) {
    case "win32":  return "CON"
    case "darwin":
    case "linux":  return "/dev/tty"
    default:       fail(`Unsupported platform: ${platform()}`)
  }
}

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}

function main() {
  const device = getTerminalDevice()
  const sixelData = readFileSync(SIXEL_FILE)

  if (sixelData.length === 0) {
    fail("Empty sixel data — run 'bun run test_pipeline.ts' first to generate test_pattern.png and sixel_output.txt")
  }

  console.error(`Writing ${sixelData.length} bytes of Sixel data to ${device}...`)

  // Open the terminal device directly and write raw bytes
  // This bypasses stdout entirely — the TUI renderer can't intercept it
  const fd = openSync(device, "w")
  writeSync(fd, sixelData)
  closeSync(fd)

  console.error("Sixel image written. Move cursor back above it to see.")
}

main()
