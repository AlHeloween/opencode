// GLM-5.3-Flash on OpenRouter, pinned to the Z.AI endpoint: same blind test as DeepSeek.
//
// Step 1 (smoke): a tiny image is sent to confirm the pinned endpoint accepts images at all.
// The endpoints API returns `modalities: null` for all 26 providers, which is a missing field
// rather than a text-only declaration - so this settles the question by experiment.
//
// Step 2: the SAME symbol-map read-back that scored 0/4 on deepseek-flash, and the same
// page-dilution arms, so the two models are directly comparable.
//
// Provider pinning: provider.only = ["z-ai"], allow_fallbacks = false. If the pinned endpoint
// refuses the request that is a result, not something to hide behind a fallback.
//
// Run: bun experiments/2026-09-12_deepseek-vision/glm-symbol-test.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "glm-test")
const MAP = join(import.meta.dir, "symbol-map.txt")
const TRUTH = join(import.meta.dir, "symbol-map-truth.json")
const URL = "https://openrouter.ai/api/v1/chat/completions"
const MODEL = process.env.GLM_MODEL ?? "z-ai/glm-5.3-flash"
const PIN = process.env.GLM_PROVIDER ?? "z-ai"

const PAGE_W = 1280
const PAGE_H = 1260
const ADV = 8
const PITCH = 15
const COLS = PAGE_W / ADV
const CELLS = COLS * (PAGE_H / PITCH)
const FONT_SIZE = 14

function loadKey(): string {
  const env = process.env.OPENROUTER_API_KEY?.trim()
  if (env) return env
  const auth = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "bin", "auth.json"), "utf8"))
  const entry = auth.openrouter ?? {}
  const key = entry.key ?? entry.apiKey ?? entry.token
  if (!key) throw new Error("no openrouter key")
  return String(key).trim()
}

const KEY = loadKey()

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function pageSvg(chunk: string): string {
  const parts: string[] = []
  for (let i = 0; i < chunk.length && i < CELLS; i++) {
    const ch = chunk[i]!
    if (ch === " " || ch === "\n" || ch === "\t") continue
    const x = (i % COLS) * ADV
    const y = Math.floor(i / COLS) * PITCH + FONT_SIZE
    parts.push(`<text x="${x}" y="${y}">${escapeXml(ch)}</text>`)
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}">`,
    `<rect width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>`,
    `<g fill="#000" font-family="Consolas" font-size="${FONT_SIZE}px" xml:space="preserve">`,
    parts.join(""),
    "</g></svg>",
  ].join("")
}

async function render(stream: string): Promise<Buffer[]> {
  const { default: sharp } = await import("sharp")
  const pages: Buffer[] = []
  for (let p = 0; p * CELLS < stream.length; p++) {
    const svg = pageSvg(stream.slice(p * CELLS, (p + 1) * CELLS))
    pages.push(await sharp(Buffer.from(svg), { density: 72 }).webp({ lossless: true, effort: 4 }).toBuffer())
  }
  return pages
}

type AskResult = {
  status: number
  text: string
  tokens?: number
  provider?: string
  error?: string
}

async function ask(images: Buffer[], prompt: string, maxTokens = 1500): Promise<AskResult> {
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
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${KEY}`,
          "content-type": "application/json",
          "user-agent": "opencode-glm-test",
          "HTTP-Referer": "https://github.com/anomalyco/opencode",
          "X-Title": "opencode image-mode test",
        },
        body: JSON.stringify(body),
      })
      const raw = await res.text()
      if (!res.ok) {
        if (attempt === 2) return { status: res.status, text: "", error: raw.slice(0, 400) }
        continue
      }
      const json = JSON.parse(raw) as {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number }
        provider?: string
      }
      return {
        status: res.status,
        text: json.choices?.[0]?.message?.content?.trim() ?? "",
        tokens: json.usage?.prompt_tokens,
        provider: json.provider,
      }
    } catch (error) {
      if (attempt === 2) return { status: 0, text: "", error: String(error).slice(0, 300) }
    }
  }
  return { status: 0, text: "", error: "unreachable" }
}

type Truth = {
  file_list: string[]
  symbols_by_file: Record<string, { name: string; kind: string; line: number; exported: boolean }[]>
}

async function main() {
  mkdirSync(DIR, { recursive: true })
  const log: string[] = []
  const say = (s = "") => {
    log.push(s)
    console.log(s)
  }

  say(`model:        ${MODEL}`)
  say(`provider pin: only=["${PIN}"], allow_fallbacks=false`)
  say("")

  say("## Step 1 - smoke")
  const { default: sharp } = await import("sharp")
  const probeSvg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="120">`,
    `<rect width="640" height="120" fill="#fff"/>`,
    `<text x="20" y="80" font-family="Consolas" font-size="56" fill="#000">GLM-VISION-OK</text>`,
    `</svg>`,
  ].join("")
  const probe = await sharp(Buffer.from(probeSvg), { density: 72 }).webp({ lossless: true }).toBuffer()
  writeFileSync(join(DIR, "smoke.webp"), probe)

  const smoke = await ask([probe], "Reply with the exact text shown in this image, nothing else.", 64)
  say(`- status ${smoke.status}, provider ${smoke.provider ?? "(not reported)"}, tokens ${smoke.tokens ?? "?"}`)
  say(`- answer: ${smoke.text || "(empty)"}`)
  if (smoke.error) say(`- error: ${smoke.error}`)
  const smokeOk = smoke.text.toUpperCase().includes("GLM-VISION-OK")
  say(`- reads images through the pinned endpoint: **${smokeOk}**`)
  say("")

  if (!smokeOk) {
    say("Smoke failed - stopping. Running the symbol-map test now would measure nothing.")
    writeFileSync(join(DIR, "RESULT.md"), log.join("\n") + "\n")
    return
  }

  const stream = readFileSync(MAP, "utf8")
  const truth = JSON.parse(readFileSync(TRUTH, "utf8")) as Truth
  say("## Step 2 - symbol map")
  say(`- map: ${truth.file_list.length} files, ${stream.length} chars, ~${Math.round(stream.length / 3.33)} tokens as text`)

  const pages = await render(stream)
  const bytes = pages.reduce((a, b) => a + b.length, 0)
  for (let i = 0; i < pages.length; i++) writeFileSync(join(DIR, `page${i + 1}.webp`), pages[i]!)
  say(`- rendered ${pages.length} pages, ${bytes} B, ${pages.length * 963} tokens as images`)
  say(`- ratio: ${(stream.length / 3.33 / (pages.length * 963)).toFixed(2)}x`)
  say("")

  const targetFile = Object.keys(truth.symbols_by_file)[0]!
  const targetSymbols = truth.symbols_by_file[targetFile]!
  say(`target file: \`${targetFile}\` (${targetSymbols.length} symbols, on page 1)`)
  say("")

  const prompt =
    `This image set is a symbol map of a codebase, rendered as pixels. ` +
    `List every symbol declared in the file ${targetFile}, one per line, in the form NAME LINE. ` +
    `Only that file.`

  const arms: [string, Buffer[]][] = [
    ["A page1 only", pages.slice(0, 1)],
    ["B pages 1-4", pages.slice(0, 4)],
    ["C all pages", pages],
  ]

  say(`| arm | images | tokens | provider | symbols named | of ${targetSymbols.length} |`)
  say("|---|---:|---:|---|---:|---:|")
  const raw: string[] = []
  for (const [label, imgs] of arms) {
    const r = await ask(imgs, prompt)
    const hay = r.text.toLowerCase()
    const hit = targetSymbols.filter((s) => hay.includes(s.name.toLowerCase())).length
    say(
      `| ${label} | ${imgs.length} | ${r.tokens ?? "?"} | ${r.provider ?? "-"} | ${hit} | ${((100 * hit) / targetSymbols.length).toFixed(0)}% |`,
    )
    raw.push(`### ${label}`, "", "```", r.text.slice(0, 2000), "```", "")
  }

  say("")
  say("### truth")
  say("```")
  say(targetSymbols.map((s) => `${s.name} ${s.line}`).join("\n"))
  say("```")
  say("")
  say("## Raw answers")
  say("")
  say(raw.join("\n"))

  writeFileSync(join(DIR, "RESULT.md"), log.join("\n") + "\n")
  console.log("")
  console.log(`written to ${join(DIR, "RESULT.md")}`)
}

main()
