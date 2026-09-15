// C5 wire probe (2026-09-07): code-as-video reading comprehension.
// Sends the rendered text_video.mp4 as video_url and asks 5 ground-truth
// questions about overflow.ts. Ground truth (I wrote this file):
//   Q1 CHARS_PER_TOKEN value = 4
//   Q2 REQUEST_OVERHEAD_TOKENS value = 10_000 (10000)
//   Q3 MAX_OUTPUT_RESERVE_TOKENS value = 32_768 (32768)
//   Q4 function names estimateContentTokens + contentTokensFromSymbols (and estimateMediaTokens)
//   Q5 EMA_ALPHA? NO — that's another file. overflow.ts has MAX_OUTPUT_RESERVE_TOKENS / FALLBACK_OUTPUT_RESERVE_TOKENS.
// Never prints the API key.
import fs from "fs"

const VIDEO = process.argv[2] ?? "experiments/2026-09-08_render-text-video/comfortable/text_video.mp4"
const AUTH = new URL("../../bin/auth.json", import.meta.url)
const key = JSON.parse(fs.readFileSync(AUTH, "utf-8")).openrouter?.key
if (!key) {
  console.error("no openrouter key found in bin/auth.json")
  process.exit(1)
}

const b64 = fs.readFileSync(VIDEO).toString("base64")
// Minimal prompt: GLM-5.3-Flash reasoning loops endlessly on the 5-question
// exact-value form (15303/16384 tokens spent thinking, answer null). One
// short question per call (looping also appears with multi-question asks).
const QUESTION = process.argv[3] ?? "the numeric value of the constant CHARS_PER_TOKEN"
const prompt =
  "The video shows a few pages of TypeScript source code. " +
  `After reading, reply with one short line: ${QUESTION} and nothing else.`

const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "z-ai/glm-5.3-flash",
    messages: [
      {
        role: "user",
        content: [
          { type: "video_url", video_url: { url: `data:video/mp4;base64,${b64}` } },
          { type: "text", text: prompt },
        ],
      },
    ],
    max_tokens: 16384,
    // Z.AI endpoint: "Reasoning is mandatory for this endpoint and cannot be
    // disabled" (400) — so give the mandatory reasoning room to finish.
  }),
})

console.log("video:", VIDEO, `(${(fs.statSync(VIDEO).size / 1024).toFixed(0)} KB)`)
console.log("http status:", response.status)
const payload = await response.json()
if (payload.error) {
  console.log("error:", JSON.stringify(payload.error).slice(0, 500))
  process.exit(1)
}
console.log("usage:", JSON.stringify(payload.usage))
console.log("--- answer ---")
console.log(payload.choices?.[0]?.message?.content)
