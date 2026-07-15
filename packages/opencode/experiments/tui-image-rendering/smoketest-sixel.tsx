/**
 * Sixel smoke test — SVG→Sixel direct pipeline, no PNG needed.
 * Run: bun run packages/opencode/experiments/tui-image-rendering/smoketest-sixel.tsx
 *
 * Renders a test SVG via resvg → Sixel and writes to terminal.
 * You should see "SIXEL TEST OK" as an image.
 */
import { renderSvgToSixel } from "../../src/util/mermaid"

const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#ff00ff"/>
      <stop offset="50%" style="stop-color:#00ffff"/>
      <stop offset="100%" style="stop-color:#0044ff"/>
    </linearGradient>
  </defs>
  <rect width="640" height="160" fill="url(#g)"/>
  <rect x="10" y="10" width="620" height="140" fill="none" stroke="#ffffff" stroke-width="2" rx="8"/>
  <text x="320" y="85" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" font-weight="bold" fill="#ffffff">SIXEL TEST OK</text>
  <text x="320" y="125" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" fill="#cccccc">resvg → Sixel pipeline</text>
</svg>`

console.log("=== Sixel Smoke Test ===")
console.log("If Sixel works, you should see a test image below:\n")

const result = renderSvgToSixel(TEST_SVG, 80)
if (result) {
  process.stdout.write(result)
  console.log("\n↑ Sixel image above")
  console.log("OK — SVG→Sixel pipeline works")
} else {
  console.log("FAIL: renderSvgToSixel returned null")
}
