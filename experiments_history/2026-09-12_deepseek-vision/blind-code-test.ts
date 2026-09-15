// BLIND TEST: can a model answer real questions about a source file it only sees as pixels?
//
// Protocol (the point is that the agent does NOT read the source into its own context):
//   1. this script reads the file, renders it to WebP pages, and computes GROUND TRUTH
//      programmatically (symbol names, constant values, line numbers);
//   2. the pages are sent to the model with questions about the code;
//   3. both answers are written to separate files, to be diffed by the caller.
//
// Two layouts are compared, because code has structure that prose does not:
//   LINES    - source line breaks preserved, long lines wrapped at 160 cols
//   FLOW     - one continuous character stream, every row filled (100% fill)
// The measured-best geometry is used for both: page 1280x1260, advance 8 px, pitch 15 px,
// 160x84 cells. Config from `sharp-verify.ts`, which passed the gate-set read-back.
//
// Run: bun experiments/2026-09-12_deepseek-vision/blind-code-test.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "blind-test")
const TARGET = process.argv[2] ?? join(import.meta.dir, "..", "..", "packages/opencode/src/session/compaction.ts")
const URL = "https://api.deepseek.com/chat/completions"
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-flash"

const PAGE_W = 1280
const PAGE_H = 1260
const ADV = 8
const PITCH = 15
const COLS = PAGE_W / ADV // 160
const ROWS = PAGE_H / PITCH // 84
const CELLS = COLS * ROWS // 13440
const FONT_SIZE = 14

function loadKey(): string {
  const env = process.env.DEEPSEEK_API_KEY?.trim()
  if (env) return env
  const auth = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "bin", "auth.json"), "utf8"))
  if (auth?.deepseek?.key) return String(auth.deepseek.key)
  throw new Error("no deepseek key")
}

const KEY = loadKey()

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
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

async function ask(images: Buffer[], prompt: string): Promise<{ text: string; tokens?: number }> {
  const content: unknown[] = images.map((b) => ({
    type: "image_url",
    image_url: { url: `data:image/webp;base64,${b.toString("base64")}` },
  }))
  content.push({ type: "text", text: prompt })
  const res = await fetch(URL, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "user-agent": "opencode-blind-test" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content }], max_tokens: 1200, thinking: { type: "disabled" } }),
  })
  if (!res.ok) return { text: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number } }
  return { text: json.choices?.[0]?.message?.content?.trim() ?? "", tokens: json.usage?.prompt_tokens }
}

// ---------------------------------------------------------------------------
// ground truth, computed from source (not from my reading of it)
// ---------------------------------------------------------------------------

function groundTruth(src: string) {
  const lines = src.split("\n")
  const funcs = [...src.matchAll(/^(?:export\s+)?function\s+(\w+)/gm)].map((m) => m[1]!)
  const consts = [...src.matchAll(/^(?:export\s+)?const\s+(\w+)\s*=\s*([^=\n]+)/gm)].map((m) => ({
    name: m[1]!,
    value: m[2]!.trim().slice(0, 60),
  }))
  const lineOf = (symbol: string) => {
    const idx = lines.findIndex((l) => new RegExp(`(?:function|const)\\s+${symbol}\\b`).test(l))
    return idx === -1 ? null : idx + 1
  }
  const numbers = Object.fromEntries(
    consts
      .filter((c) => /^[\d_]+$/.test(c.value.replace(/_/g, "")))
      .map((c) => [c.name, Number(c.value.replace(/_/g, ""))]),
  )
  return { lines: lines.length, chars: src.length, funcs, consts, lineOf, numbers }
}

function toLines(src: string): string {
  // preserve line breaks; wrap over-long lines at COLS
  const out: string[] = []
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\t/g, "    ")
    if (line.length <= COLS) {
      out.push(line)
      continue
    }
    for (let i = 0; i < line.length; i += COLS) out.push(line.slice(i, i + COLS))
  }
  return out.join("\n")
}

function toFlow(src: string): string {
  return src.replace(/\s+/g, " ").trim()
}

async function main() {
  mkdirSync(DIR, { recursive: true })
  const src = readFileSync(TARGET, "utf8")
  const gt = groundTruth(src)
  writeFileSync(join(DIR, "ground-truth.json"), JSON.stringify(gt, null, 2))

  console.log(`target: ${TARGET}`)
  console.log(`source: ${gt.lines} lines, ${gt.chars} chars`)
  console.log(`top-level functions: ${gt.funcs.length}`)
  console.log(`top-level consts:    ${gt.consts.length}`)
  console.log("")

  const questions: [string, string][] = [
    [
      "function list",
      "This image set contains a TypeScript source file rendered as pixels. " +
        "List every top-level function it declares, exactly as named, one per line. " +
        "If a name is exported, mark it with the export keyword.",
    ],
    [
      "named constants",
      "List every top-level `const` declared in this file with its literal value, one per line, " +
        "in the form NAME = VALUE. Only include ones whose value is a number or a short literal.",
    ],
    [
      "specific value",
      "In this file, what is the exact numeric value of SUMMARY_INTERVAL_TOKENS and of " +
        "MAX_SUMMARY_BODY_TOKENS? Answer as NAME=VALUE, one per line.",
    ],
    [
      "purpose + line",
      "What does the function computeOpenWindowTokens do, and at roughly what line number is it " +
        "declared? Answer in two short lines: PURPOSE: ... and LINE: ...",
    ],
  ]

  const layouts: [string, string][] = [
    ["LINES", toLines(src)],
    ["FLOW", toFlow(src)],
  ]

  const report: string[] = []
  for (const [name, stream] of layouts) {
    const t0 = Date.now()
    const pages = await render(stream)
    const ms = Date.now() - t0
    const bytes = pages.reduce((a, b) => a + b.length, 0)
    for (let i = 0; i < pages.length; i++) writeFileSync(join(DIR, `${name}-page${i + 1}.webp`), pages[i]!)
    console.log(`== ${name}: ${stream.length} chars -> ${pages.length} pages, ${bytes} B, ${ms} ms ==`)
    report.push(`\n## Layout ${name}: ${pages.length} pages, ${bytes} bytes\n`)

    for (const [qname, prompt] of questions) {
      const { text, tokens } = await ask(pages, prompt)
      console.log(`\n--- ${qname} (tokens=${tokens}) ---`)
      console.log(text)
      report.push(`\n### ${qname} (tokens=${tokens})\n\n${text}\n`)
    }
    console.log("")
    writeFileSync(join(DIR, `answers-${name}.md`), report.join("\n"))
  }

  writeFileSync(join(DIR, "answers.md"), report.join("\n"))
  console.log(`answers written to ${join(DIR, "answers.md")}`)
  console.log(`ground truth written to ${join(DIR, "ground-truth.json")}`)
}

main()
