// Two anomalies in the GLM run, both load-bearing for the whole idea.
//
// 1. EMPTY CONTENT. All three arms returned 200 OK, consumed prompt tokens, and produced an
//    empty answer. That smells like the reasoning budget eating max_tokens, or a parameter the
//    endpoint wants. Logging finish_reason distinguishes "model refused" from "output truncated".
//
// 2. TOKEN ACCOUNTING. 20 pages cost 41,492 prompt tokens on GLM versus 19,304 on DeepSeek -
//    about 2x. If image tokens are NOT capped near 1024 on this endpoint, the entire economics
//    change: the multiplier was never about the model reading pictures, it was about the vendor
//    normalising them to a fixed price. This measures the scaling curve directly by varying the
//    canvas size with the SAME content.
//
// Run: bun experiments/2026-09-12_deepseek-vision/glm-diagnose.ts

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "glm-test")
const URL = "https://openrouter.ai/api/v1/chat/completions"
const MODEL = process.env.GLM_MODEL ?? "z-ai/glm-5.3-flash"
const PIN = process.env.GLM_PROVIDER ?? "z-ai"

function loadKey(): string {
  const env = process.env.OPENROUTER_API_KEY?.trim()
  if (env) return env
  const auth = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "bin", "auth.json"), "utf8"))
  return String(auth.openrouter.key).trim()
}

const KEY = loadKey()

type Result = {
  status: number
  text: string
  reasoning?: string
  tokens?: number
  completion?: number
  finish?: string
  provider?: string
  error?: string
}

async function ask(images: Buffer[], prompt: string, maxTokens: number, extra: Record<string, unknown> = {}): Promise<Result> {
  const content: unknown[] = images.map((b) => ({
    type: "image_url",
    image_url: { url: `data:image/webp;base64,${b.toString("base64")}` },
  }))
  content.push({ type: "text", text: prompt })

  const body = {
    model: MODEL,
    messages: [{ role: "user", content }],
    max_tokens: maxTokens,
    provider: { only: [PIN], allow_fallbacks: false },
    ...extra,
  }

  const res = await fetch(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "user-agent": "opencode-glm-diag",
      "HTTP-Referer": "https://github.com/anomalyco/opencode",
      "X-Title": "opencode image-mode diagnostic",
    },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  if (!res.ok) return { status: res.status, text: "", error: raw.slice(0, 500) }

  const json = JSON.parse(raw) as {
    choices?: { message?: { content?: string; reasoning?: string }; finish_reason?: string }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
    provider?: string
    error?: { message?: string }
  }
  const choice = json.choices?.[0]
  return {
    status: res.status,
    text: choice?.message?.content?.trim() ?? "",
    reasoning: choice?.message?.reasoning,
    tokens: json.usage?.prompt_tokens,
    completion: json.usage?.completion_tokens,
    finish: choice?.finish_reason,
    provider: json.provider,
    error: json.error?.message,
  }
}

async function main() {
  mkdirSync(DIR, { recursive: true })
  const { default: sharp } = await import("sharp")
  const log: string[] = []
  const say = (s = "") => {
    log.push(s)
    console.log(s)
  }

  // ---- Problem 1: why empty ---------------------------------------------------------
  say("## 1. Empty content: finish_reason diagnosis")
  say("")
  const page = readFileSync(join(DIR, "page1.webp"))
  const question = "This image is a symbol map rendered as pixels. Name the first five symbol names you can read, one per line."

  for (const maxTokens of [256, 1024, 4096]) {
    const r = await ask([page], question, maxTokens)
    say(`- max_tokens=${maxTokens}: status=${r.status} finish=${r.finish ?? "?"} prompt=${r.tokens} completion=${r.completion} content=${r.text.length} chars reasoning=${(r.reasoning ?? "").length} chars`)
    if (r.error) say(`  error: ${r.error}`)
    if (r.text) say(`  text: ${r.text.slice(0, 160).replace(/\n/g, " | ")}`)
  }
  say("")

  // Try an explicit thinking control if the plain form truncates.
  say("### with reasoning disabled")
  const off = await ask([page], question, 1024, { reasoning: { enabled: false } })
  say(`- status=${off.status} finish=${off.finish ?? "?"} prompt=${off.tokens} completion=${off.completion} content=${off.text.length}`)
  if (off.text) say(`  text: ${off.text.slice(0, 200).replace(/\n/g, " | ")}`)
  if (off.error) say(`  error: ${off.error}`)
  say("")

  // ---- Problem 2: image token scaling -----------------------------------------------
  say("## 2. Image token scaling: does the vendor cap the price per image?")
  say("")
  say("The same rendered page is resized so the *content* is identical and only the pixel count")
  say("changes. On DeepSeek tokens stop growing at ~1.64M px because the server normalises to a")
  say("fixed budget; if GLM keeps charging, the economics are vendor-specific.")
  say("")
  say("| canvas | pixels | png/webp bytes | prompt_tokens | vs 1280 |")
  say("|---:|---:|---:|---:|---:|")

  const base = await sharp(page).metadata()
  const baseTokens: number[] = []
  for (const side of [640, 896, 1280, 1536, 1792, 2048]) {
    const resized = await sharp(page)
      .resize(side, Math.round((side * (base.height ?? 1260)) / (base.width ?? 1280)), { fit: "fill" })
      .webp({ lossless: true, effort: 4 })
      .toBuffer()
    const r = await ask([resized], "Reply with the single word OK.", 16)
    baseTokens.push(r.tokens ?? 0)
    say(`| ${side} | ${(side * side * ((base.height ?? 1260) / (base.width ?? 1280))).toFixed(0)} | ${resized.length} | ${r.tokens ?? "?"} | ${baseTokens[0] ? ((r.tokens ?? 0) / baseTokens[0]).toFixed(2) : "-"}x |`)
  }
  say("")
  say("## 3. Several pages at once: is the cost per image or per request?")
  say("")
  say("| images | prompt_tokens | delta |")
  say("|---:|---:|---:|")
  const pages = [1, 2, 3, 4].map((n) => readFileSync(join(DIR, `page${n}.webp`)))
  let previous = 0
  for (let n = 1; n <= 4; n++) {
    const r = await ask(pages.slice(0, n), "Reply with the single word OK.", 16)
    const delta = previous ? (r.tokens ?? 0) - previous : 0
    say(`| ${n} | ${r.tokens ?? "?"} | ${previous ? delta : "-"} |`)
    previous = r.tokens ?? 0
  }

  writeFileSync(join(DIR, "DIAGNOSE.md"), log.join("\n") + "\n")
  console.log("")
  console.log(`written to ${join(DIR, "DIAGNOSE.md")}`)
}

main()
