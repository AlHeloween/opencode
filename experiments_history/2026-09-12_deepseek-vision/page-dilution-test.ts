// Is the failure CONTENT or PAGE COUNT? One question, one page of truth, varying how many
// images ride along with it.
//
// Evidence so far, same renderer and geometry throughout:
//   kernel           3 pages  -> read correctly (gate set exact, terminals named)
//   source file      4 pages  -> 51% recall on function names
//   symbol map      20 pages  -> 0/4 questions
// The trend points at attention dilution as the variable, not the layout.
//
// Method: the symbol map is rendered once into 20 pages. One question is asked - "list the
// symbols in <file X>", where X is the FIRST file in the map, so its symbols are on page 1.
// The question is sent three times:
//   A  page 1 only              - is the content readable at all?
//   B  pages 1-4                - near the size that read sources at 51%
//   C  all 20 pages             - the failing configuration, unchanged
// Page 1 is byte-identical in all three, and the question is identical, so any accuracy
// difference is attributable to the extra images.
//
// Run: bun experiments/2026-09-12_deepseek-vision/page-dilution-test.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "page-dilution")
const MAP = join(import.meta.dir, "symbol-map.txt")
const TRUTH = join(import.meta.dir, "symbol-map-truth.json")
const URL = "https://api.deepseek.com/chat/completions"
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-flash"

const PAGE_W = 1280
const PAGE_H = 1260
const ADV = 8
const PITCH = 15
const COLS = PAGE_W / ADV
const CELLS = COLS * (PAGE_H / PITCH)
const FONT_SIZE = 14

function loadKey(): string {
  const env = process.env.DEEPSEEK_API_KEY?.trim()
  if (env) return env
  const auth = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "bin", "auth.json"), "utf8"))
  return String(auth.deepseek.key)
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

  // Streaming off; retry once on transport errors so a flaky call is not scored as a wrong answer.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "user-agent": "opencode-dilution" },
        body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content }], max_tokens: 1200, thinking: { type: "disabled" } }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number } }
      const text = json.choices?.[0]?.message?.content?.trim() ?? ""
      if (text) return { text, tokens: json.usage?.prompt_tokens }
    } catch (error) {
      if (attempt === 2) return { text: `ERROR: ${String(error).slice(0, 200)}` }
    }
  }
  return { text: "" }
}

type Truth = {
  file_list: string[]
  symbols_by_file: Record<string, { name: string; kind: string; line: number; exported: boolean }[]>
}

function scoreSymbols(answer: string, want: { name: string }[]): { hit: number; total: number } {
  // count how many real symbol names appear anywhere in the answer
  const hay = answer.toLowerCase()
  const hit = want.filter((s) => hay.includes(s.name.toLowerCase())).length
  return { hit, total: want.length }
}

async function main() {
  mkdirSync(DIR, { recursive: true })
  const stream = readFileSync(MAP, "utf8")
  const truth = JSON.parse(readFileSync(TRUTH, "utf8")) as Truth

  // The first file in the map - its symbols land on page 1.
  const targetFile = Object.keys(truth.symbols_by_file)[0]!
  const targetSymbols = truth.symbols_by_file[targetFile]!
  console.log(`target file: ${targetFile} (${targetSymbols.length} symbols, on page 1)`)
  console.log("")

  const pages = await render(stream)
  console.log(`map rendered to ${pages.length} pages`)
  for (let i = 0; i < pages.length; i++) writeFileSync(join(DIR, `page${i + 1}.webp`), pages[i]!)
  console.log("")

  const prompt =
    `This image set is a symbol map of a codebase, rendered as pixels. ` +
    `List every symbol declared in the file ${targetFile}, one per line, in the form NAME LINE. ` +
    `Only that file.`

  const arms: [string, Buffer[]][] = [
    ["A page1 only", pages.slice(0, 1)],
    ["B pages 1-4", pages.slice(0, 4)],
    ["C all pages", pages],
  ]

  const report: string[] = [
    "# Page dilution test",
    "",
    `Question: list the symbols in \`${targetFile}\` (page 1 of the map).`,
    `Ground truth: ${targetSymbols.length} symbols.`,
    "",
    `| arm | pages attached | tokens | symbols named | of ${targetSymbols.length} |`,
    "|---|---:|---:|---:|---:|",
  ]

  for (const [label, imgs] of arms) {
    const { text, tokens } = await ask(imgs, prompt)
    const { hit, total } = scoreSymbols(text, targetSymbols)
    console.log(`== ${label}: ${imgs.length} images, tokens=${tokens} ==`)
    console.log(`named ${hit}/${total} real symbols`)
    console.log(text.split("\n").slice(0, 20).join("\n"))
    console.log("")
    report.push(`| ${label} | ${imgs.length} | ${tokens} | ${hit} | ${((100 * hit) / total).toFixed(0)}% |`)
    report.push("")
    report.push(`## ${label}`)
    report.push("")
    report.push("```")
    report.push(text.slice(0, 2500))
    report.push("```")
    report.push("")
    writeFileSync(join(DIR, "RESULT.md"), report.join("\n"))
  }

  console.log("ground truth symbols:")
  console.log(targetSymbols.map((s) => `${s.name} ${s.line}`).join("\n"))
  writeFileSync(join(DIR, "RESULT.md"), report.join("\n") + "\n\ntruth:\n```\n" + targetSymbols.map((s) => `${s.name} ${s.line}`).join("\n") + "\n```\n")
}

main()
