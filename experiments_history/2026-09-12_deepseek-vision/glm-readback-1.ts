// GLM-5.3-Flash read-back, sized to finish: one arm, one page, incremental writes.
//
// Two runs now died mid-answer. Diagnosis for both: a thinking model spends ~2,000 tokens of
// reasoning before emitting anything, and a 174-symbol target invites a very long answer - the
// pair exceeds what a single request tolerates here. Fixes, all structural:
//   * ONE arm per invocation, one page - the smallest question that still proves reading
//   * max_tokens 12,000 with reasoning captured separately from content
//   * every result is APPENDED to disk immediately, so a killed run still leaves evidence
//   * the target file is chosen to have a bounded number of symbols (20-40), not the largest
//
// Budget note: reasoning is mandatory on this endpoint (400 if disabled), so a low max_tokens
// truncates silently to empty content. Measured: 256 -> content="", 1024 -> content=86 chars.
//
// Run: cmd_runner start --cwd experiments/2026-09-12_deepseek-vision -- bun glm-readback-1.ts

import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "glm-test")
const LOG = join(DIR, "READBACK.md")
const MAP = join(import.meta.dir, "symbol-map.txt")
const TRUTH = join(import.meta.dir, "symbol-map-truth.json")
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

function note(line: string) {
  appendFileSync(LOG, line + "\n", "utf8")
  console.log(line)
}

type Truth = {
  file_list: string[]
  symbols_by_file: Record<string, { name: string; kind: string; line: number; exported: boolean }[]>
}

async function main() {
  writeFileSync(LOG, "# GLM-5.3-Flash single-page read-back\n\n", "utf8")
  const truth = JSON.parse(readFileSync(TRUTH, "utf8")) as Truth

  // Bounded target: 12..40 symbols keeps the answer short enough to complete.
  const entries = Object.entries(truth.symbols_by_file)
    .filter(([, syms]) => syms.length >= 12 && syms.length <= 40)
    .sort((a, b) => a[1].length - b[1].length)
  const [targetFile, targetSymbols] = entries[0]!

  note(`- model: ${MODEL}, pinned "${PIN}", allow_fallbacks=false`)
  note(`- target: \`${targetFile}\` — ${targetSymbols.length} symbols`)
  note("")

  const page = readFileSync(join(DIR, "page1.webp"))
  note(`- page1.webp: ${page.length} bytes`)

  const prompt =
    `This image is the first page of a symbol map, rendered as pixels. ` +
    `List every symbol you can read that belongs to the file ${targetFile}, ` +
    `one per line as NAME LINE. If the file is not on this page, say NOT_ON_PAGE.`

  const started = Date.now()
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "user-agent": "opencode-glm-readback",
      "HTTP-Referer": "https://github.com/anomalyco/opencode",
      "X-Title": "opencode image-mode test",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/webp;base64,${page.toString("base64")}` } }, { type: "text", text: prompt }] }],
      max_tokens: 12000,
      provider: { only: [PIN], allow_fallbacks: false },
    }),
  })

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  const raw = await res.text()
  note(`- http ${res.status}, ${elapsed}s, ${raw.length} bytes of response`)

  if (!res.ok) {
    note(`- error: ${raw.slice(0, 400)}`)
    return
  }

  const json = JSON.parse(raw) as {
    choices?: { message?: { content?: string; reasoning?: string }; finish_reason?: string }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
    provider?: string
  }
  const choice = json.choices?.[0]
  const content = choice?.message?.content?.trim() ?? ""
  const reasoning = choice?.message?.reasoning ?? ""

  note(`- provider: ${json.provider ?? "?"}, finish: ${choice?.finish_reason ?? "?"}`)
  note(`- tokens: prompt ${json.usage?.prompt_tokens}, completion ${json.usage?.completion_tokens}`)
  note(`- reasoning: ${reasoning.length} chars | content: ${content.length} chars`)
  note("")

  const hay = content.toLowerCase()
  const hit = targetSymbols.filter((s) => hay.includes(s.name.toLowerCase())).length
  note(`**symbols named: ${hit} / ${targetSymbols.length} = ${((100 * hit) / targetSymbols.length).toFixed(0)}%**`)
  note("")

  note("## content")
  note("```")
  note(content.slice(0, 3000))
  note("```")
  note("")
  note("## reasoning (first 800 chars)")
  note("```")
  note(reasoning.slice(0, 800))
  note("```")
  note("")
  note("## ground truth")
  note("```")
  note(targetSymbols.map((s) => `${s.name} ${s.line}`).join("\n"))
  note("```")
}

main()
