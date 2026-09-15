// One-off wire probe (2026-09-07): native video input via OpenRouter.
// Sends D:/generated_video.mp4 as a video_url content block and asks the
// model what happens in it. Mirrors the OpenRouter docs example for
// z-ai/glm-5.3-flash. Never prints the API key.
import fs from "fs"

const VIDEO = "D:/generated_video.mp4"
const AUTH = new URL("../../bin/auth.json", import.meta.url)

const stat = fs.statSync(VIDEO)
console.log("video size:", (stat.size / 1048576).toFixed(2), "MiB")

const auth = JSON.parse(fs.readFileSync(AUTH, "utf-8"))
const key = auth.openrouter?.key
if (!key) {
  console.error("no openrouter key found in bin/auth.json")
  process.exit(1)
}

const b64 = fs.readFileSync(VIDEO).toString("base64")
console.log("base64 length:", b64.length)

const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "z-ai/glm-5.3-flash",
    messages: [
      {
        role: "user",
        content: [
          { type: "video_url", video_url: { url: `data:video/mp4;base64,${b64}` } },
          { type: "text", text: "What happens in this video? Describe it briefly." },
        ],
      },
    ],
    max_tokens: 512,
  }),
})

console.log("http status:", response.status)
const payload = await response.json()
if (payload.error) {
  console.log("error:", JSON.stringify(payload.error).slice(0, 500))
} else {
  const choice = payload.choices?.[0]?.message
  console.log("model:", payload.model, "usage:", JSON.stringify(payload.usage))
  console.log("answer:", choice?.content?.slice(0, 1200))
}
