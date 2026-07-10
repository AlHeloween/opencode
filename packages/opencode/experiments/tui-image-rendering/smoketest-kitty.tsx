/**
 * Kitty graphics protocol smoketest — actual image rendering in terminal.
 */
import { kittyImage } from "../../src/util/kitty-render"

const IMAGE = process.argv[2] ?? "D:/zPython/opencode/experiments/vision/dragon.jpg"

const seq = await kittyImage(IMAGE, 80)

// Clear screen, emit Kitty image, show info
process.stdout.write("\x1b[2J\x1b[H")
process.stdout.write(seq)
process.stdout.write(`\n  \x1b[1;32mKitty Graphics: ${IMAGE.split("/").pop()}\x1b[0m\n`)
process.stdout.write("  Press Enter to exit...")

process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on("data", (d) => {
  if (d[0] === 13 || d[0] === 3 || d[0] === 27) {
    process.stdout.write("\x1b[2J\x1b[H")
    process.exit(0)
  }
})
