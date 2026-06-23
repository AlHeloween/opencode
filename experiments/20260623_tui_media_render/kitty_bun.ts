/**
 * Minimal kitty protocol test — no mpv, no chafa, just raw escape codes.
 * If this renders, kitty works and mpv was the problem.
 * If not, WT kitty support is not active.
 */

const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"

console.log(`${BOLD}=== Kitty Protocol Direct Test ===${RESET}\n`)

// Create a minimal 1x1 red PNG (valid PNG bytes)
// 1x1 pixel, RGB red (#FF0000)
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde,                                         // IHDR CRC
  0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
  0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0xff, 0x3f, // compressed red pixel
  0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59,
  0xe7,                                         // IDAT CRC
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND
  0xae, 0x42, 0x60, 0x82,                       // IEND CRC
])

// Base64 encode
const b64 = Buffer.from(png).toString("base64")

// Kitty protocol: ESC _ G f=24,... ; base64 ESC \
// f=24 = PNG format, s=width, v=height, c=cols, r=rows
const kittyCmd = `\x1b_Gf=24,s=200,v=200,c=200,r=200;${b64}\x1b\\`
const kittyCmdSmall = `\x1b_Gf=24,s=50,v=50,c=50,r=50;${b64}\x1b\\`

console.log("Sending kitty protocol image (200x200 rendered)...\n")
process.stdout.write(kittyCmd)
process.stdout.write(kittyCmdSmall)
console.log("\n")

console.log("Sending kitty protocol image (50x50 rendered)...\n")
process.stdout.write(kittyCmdSmall)
console.log("\n")

console.log(`${YELLOW}If you see a RED square above: kitty protocol WORKS${RESET}`)
console.log(`${YELLOW}If you see base64 text:        kitty NOT supported${RESET}`)
console.log(`${YELLOW}If you see nothing:            escape codes swallowed${RESET}`)

// Also test: just print the escape sequences as text for debugging
console.log(`\n${BOLD}=== Debug: escape sequence length ===${RESET}`)
console.log(`Raw kitty command: ${kittyCmd.length} bytes`)
console.log(`Base64 payload: ${b64.length} chars`)
console.log(`PNG file: ${png.length} bytes`)
console.log(`\nFirst 80 chars of base64: ${b64.slice(0, 80)}`)
