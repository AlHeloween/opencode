// Smoke (2026-09-07): token estimation after the phantom-compact fix.
// 1. A 2.7M-char data:video URL must cost a fixed small allowance (~3000 tokens), NOT len/4 (~688K).
// 2. A text tool output still counts as chars/4.
import { estimateToolOutputTokens } from "../../packages/opencode/src/session/overflow.ts"
import { contentTokensFromSymbols } from "../../packages/opencode/src/session/overflow.ts"

const blob = "data:video/mp4;base64," + "A".repeat(2_750_000)

const withVideo = estimateToolOutputTokens("Video read successfully (native video input)", [
  { mime: "video/mp4", url: blob },
])
const textOnly = estimateToolOutputTokens("x".repeat(4000))
const withImage = estimateToolOutputTokens("Image read successfully", [{ mime: "image/jpeg", url: "data:image/jpeg;base64," + "A".repeat(900_000) }])

console.log("video blob chars counted:", withVideo, "-> tokens:", contentTokensFromSymbols(withVideo), "(expect ~3000, was ~688k)")
console.log("4000-char text -> tokens:", contentTokensFromSymbols(textOnly), "(expect 1000)")
console.log("image blob -> tokens:", contentTokensFromSymbols(withImage), "(expect ~1500)")
