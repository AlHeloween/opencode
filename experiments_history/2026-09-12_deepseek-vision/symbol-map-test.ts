// Read-back test on a real codegraph symbol map: does the model answer CODE questions
// correctly from pixels?
//
// Why this test differs from the earlier blind test:
//   blind-code-test.ts rendered raw SOURCE (prose + code) and scored 12-52% recall.
//   This renders a SYMBOL MAP - names, kinds, line numbers, edges - which is the content
//   class the blind test showed to survive (structure read fine, prose did not).
//
// The map is 253,469 chars (132 files, 3,060 symbols, 7,797 edges) = ~76,117 tokens as
// text, packed into 19 image pages = ~18,297 tokens. 4.16x cheaper - and it is the exact
// artifact an agent consumes instead of reading files.
//
// Questions are answerable ONLY by reading the map: they ask about symbols and line numbers
// that exist in the database, and the ground truth was computed from the database, not from
// my reading. Scoring is mechanical (score-js: exact string match against truth).
//
// Run: bun experiments/2026-09-12_deepseek-vision/symbol-map-test.ts [question-count]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "symbol-map-test")
const MAP = join(import.meta.dir, "symbol-map.txt")
const TRUTH = join(import.meta.dir, "symbol-map-truth.json")
const URL = "https://api.deepseek.com/chat/completions"
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-flash"

const PAGE_W = 1280
const PAGE_H = 1260
const ADV = 8
const PITCH = 15
const COLS = PAGE_W / ADV
const ROWS = PAGE_H / PITCH
const CELLS = COLS * ROWS
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

async function ask(images: Buffer[], prompt: string, maxTokens = 1500): Promise<{ text: string; tokens?: number }> {
  const content: unknown[] = images.map((b) => ({
    type: "image_url",
    image_url: { url: `data:image/webp;base64,${b.toString("base64")}` },
  }))
  content.push({ type: "text", text: prompt })
  const res = await fetch(URL, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "user-agent": "opencode-symbol-map" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content }], max_tokens: maxTokens, thinking: { type: "disabled" } }),
  })
  if (!res.ok) return { text: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number } }
  return { text: json.choices?.[0]?.message?.content?.trim() ?? "", tokens: json.usage?.prompt_tokens }
}

type Truth = {
  files: number
  symbols: number
  edges: number
  chars: number
  est_text_tokens: number
  file_list: string[]
  symbols_by_file: Record<string, { name: string; kind: string; line: number; exported: boolean }[]>
}

function buildQuestions(truth: Truth): [string, string, (t: string) => boolean][] {
  // Deterministically pick real symbols from the truth so every answer is checkable.
  const filesWithSymbols = Object.entries(truth.symbols_by_file).filter(([, s]) => s.length >= 4)
  const [fileA, symsA] = filesWithSymbols[0]!
  const [fileB, symsB] = filesWithSymbols[Math.floor(filesWithSymbols.length / 2)]!
  const probeA = symsA.find((s) => s.kind === "function") ?? symsA[0]!
  const probeB = symsB.find((s) => s.kind === "function") ?? symsB[0]!
  const exportedA = symsA.find((s) => s.exported) ?? symsA[0]!

  return [
    [
      "file list",
      "This image set is a symbol map of a codebase. List every FILE it covers, one per line, " +
        "exactly as named in the map.",
      (t) => {
        const got = new Set(t.split("\n").map((l) => l.trim().replace(/^@/, "").replace(/[`*]/g, "")).filter(Boolean))
        const want = truth.file_list
        const hits = want.filter((f) => got.has(f)).length
        return hits >= want.length * 0.9
      },
    ],
    [
      "symbols in one file",
      `In the map, list every symbol declared in the file ${fileA}, in the order they appear, ` +
        "with their line numbers. One per line as NAME LINE.",
      (t) => {
        const want = truth.symbols_by_file[fileA]!
        const hits = want.filter((s) => t.includes(s.name)).length
        return hits >= want.length * 0.8
      },
    ],
    [
      "line number accuracy",
      `What is the line number of the symbol ${probeB.name} in ${fileB}? Answer with the number only.`,
      (t) => {
        const nums = [...t.matchAll(/\b(\d{1,5})\b/g)].map((m) => Number(m[1]))
        return nums.some((n) => Math.abs(n - probeB.line) <= 1)
      },
    ],
    [
      "exported check",
      `Is the symbol ${exportedA.name} in ${fileA} marked as exported in this map? ` +
        "Answer YES or NO first, then the line you read it from.",
      (t) => {
        const verdict = t.trim().toUpperCase().startsWith("YES")
        return verdict === exportedA.exported
      },
    ],
  ]
}

async function main() {
  mkdirSync(DIR, { recursive: true })
  const stream = readFileSync(MAP, "utf8")
  const truth = JSON.parse(readFileSync(TRUTH, "utf8")) as Truth

  console.log(`map: ${truth.files} files, ${truth.symbols} symbols, ${truth.edges} edges`)
  console.log(`chars: ${truth.chars} | as text ~${truth.est_text_tokens} tokens`)
  console.log("")

  const t0 = Date.now()
  const pages = await render(stream)
  const ms = Date.now() - t0
  const bytes = pages.reduce((a, b) => a + b.length, 0)
  for (let i = 0; i < pages.length; i++) writeFileSync(join(DIR, `page${i + 1}.webp`), pages[i]!)
  console.log(`rendered ${pages.length} pages, ${bytes} B, ${ms} ms`)
  console.log(`as images: ${pages.length} x 963 = ${pages.length * 963} tokens`)
  console.log(`ratio text/images = ${(truth.est_text_tokens / (pages.length * 963)).toFixed(2)}x`)
  console.log("")

  const questions = buildQuestions(truth)
  const results: string[] = []
  let passed = 0

  for (const [name, prompt, check] of questions) {
    const { text, tokens } = await ask(pages, prompt)
    const ok = check(text)
    if (ok) passed++
    console.log(`[${ok ? "PASS" : "FAIL"}] ${name} (tokens=${tokens})`)
    console.log(text.split("\n").slice(0, 12).join("\n"))
    console.log("")
    results.push(`## ${name}\n\n**${ok ? "PASS" : "FAIL"}** (tokens=${tokens})\n\n\`\`\`\n${text}\n\`\`\`\n`)
  }

  const summary = [
    `# Symbol map read-back: ${passed}/${questions.length} correct`,
    "",
    `- map: ${truth.files} files, ${truth.symbols} symbols, ${truth.edges} edges`,
    `- chars ${truth.chars} -> ~${truth.est_text_tokens} tokens as text`,
    `- rendered ${pages.length} pages (${bytes} B) -> ${pages.length * 963} tokens as images`,
    `- ratio: **${(truth.est_text_tokens / (pages.length * 963)).toFixed(2)}x cheaper as images**`,
    "",
    ...results,
  ].join("\n")
  writeFileSync(join(DIR, "RESULT.md"), summary)
  console.log(`RESULT: ${passed}/${questions.length} questions correct`)
  console.log(`written to ${join(DIR, "RESULT.md")}`)
}

main()
