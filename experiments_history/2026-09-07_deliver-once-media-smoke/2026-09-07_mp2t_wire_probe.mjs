// Wire probe (2026-09-07): does the provider accept MPEG-TS (video/mp2t)?
// A) mp2t bytes declared honestly as video/mp2t  -> expect rejection
// B) mp2t bytes MISLABELED as video/mp4          -> does the provider sniff?
// Same H.264 stream as the proven-good generated_video.mp4 (container-only
// remux). Never prints the API key.
import fs from "fs"

const AUTH = new URL("../../bin/auth.json", import.meta.url)
const key = JSON.parse(fs.readFileSync(AUTH, "utf-8")).openrouter?.key
if (!key) {
  console.error("no openrouter key found in bin/auth.json")
  process.exit(1)
}

const b64 = fs.readFileSync("D:/generated_video.ts").toString("base64")
console.log("mp2t size:", (fs.statSync("D:/generated_video.ts").size / 1048576).toFixed(2), "MiB, base64 len:", b64.length)

async function probe(label, mime) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "z-ai/glm-5.3-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "video_url", video_url: { url: `data:${mime};base64,${b64}` } },
            { type: "text", text: "What happens in this video? One sentence." },
          ],
        },
      ],
      max_tokens: 256,
    }),
  })
  console.log(`\n[${label}] declared data URL mime: ${mime}`)
  console.log(`[${label}] http status:`, response.status)
  const payload = await response.json()
  if (payload.error) {
    console.log(`[${label}] error:`, JSON.stringify(payload.error).slice(0, 400))
  } else {
    console.log(`[${label}] usage:`, JSON.stringify(payload.usage))
    console.log(`[${label}] answer:`, payload.choices?.[0]?.message?.content?.slice(0, 300))
  }
}

await probe("A honest-mp2t", "video/mp2t")
await probe("B mp2t-as-mp4", "video/mp4")
