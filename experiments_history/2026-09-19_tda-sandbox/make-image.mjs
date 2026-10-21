// The sandbox's carrier image: a solid red square.
//
// Solid colour on purpose — the model's answer becomes CHECKABLE ("red" or not), so a run that
// silently dropped the image cannot pass as a run that worked. Deterministic and tiny, so the base64
// payload that reaches the wire is small enough to read in the captured body.
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const out = fileURLToPath(new URL("./red.png", import.meta.url))
await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 20, b: 20 } } })
  .png()
  .toFile(out)
console.log("wrote", out)
