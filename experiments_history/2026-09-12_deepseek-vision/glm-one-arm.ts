// One clean, survivable GLM measurement.
//
// Two defects in the previous attempts, both mine:
//   * the target file (message-v2.ts, 174 symbols) is spread across the whole map, so the
//     "page 1 only" arm could never contain it - the question was unanswerable by construction;
//   * results were written only at the end, so a killed job left nothing behind.
//
// Fixes: the target file is chosen from what is PHYSICALLY on page 1 (its symbols must fall
// inside the first CELLS characters of the map), one arm runs per invocation, and every result
// is appended to disk before the next step.
//
// GLM specifics that the diagnostic established (glm-test/DIAGNOSE.md):
//   * reasoning is mandatory and spends ~1,700-5,500 tokens before content; max_tokens must be
//     large, and `finish_reason=length` means truncated, not wrong;
//   * content and reasoning are read separately.
//
// Run: bun experiments/2026-09-12_deepseek-vision/glm-one-arm.ts [arm]
//   arm: "1" (page 1 only, default) or "4" (pages 1-4)

import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "glm-test")
const MAP = join(import.meta.dir, "symbol-map.txt")
const TRUTH = join(import.meta.dir, "symbol-map-truth.json")
const OUT = join(DIR, "READBACK.md")
const URL = "https://openrouter.ai/api/v1/chat/completions"
const MODEL = process.env.GLM_MODEL ?? "z-ai/glm-5.3-flash"
const PIN = process.env.GLM_PROVIDER ?? "z-ai"
const ARM = process.argv[2] ?? "1"

const CELLS = 160 * 84 // one page

function loadKey(): string {
  const env = process.env.OPENROUTER_API_KEY?.trim()
  if (env) return env
  const auth = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "bin", "auth.json"), "utf8"))
  return String(auth.openrouter.key).trim()
}

const KEY = loadKey()

type Truth = {
  symbols_by_file: Record<string, { name: string; kind: string; line: number; exported: boolean }[]>
}

/** Files whose symbols all fall inside the first page's character window. */
function filesOnFirstPage(stream: string, truth: Truth): [string, { name: string; line: number }[]][] {
  const window = stream.slice(0, CELLS)
  const out: [string, { name: string; line: number }[]][] = []
  for (const [file, symbols] of Object.entries(truth.symbols_by_file)) {
    // a file is "on page 1" if its @header marker and all its symbol names appear in the window
    const short = file.split("/").pop()!
    if (!window.includes(`@${short}`)) continue
    const present = symbols.filter((s) => window.includes(s.name))
    if (present.length !== symbols.length) continue
    if (present.length < 3) continue
    out.push([file, present.map((s) => ({ name: s.name, line: s.line }))])
  }
  return out.sort((a, b) => b[1].length - a[1].length)
}

async function ask(images: Buffer[], prompt: string, maxTokens = 16_000) {
  const content: unknown[] = images.map((b) => ({
    type: "image_url",
    image_url: { url: `data:image/webp;base64,${b.toString("base64")}` },
  }))
  content.push({ type: "text", text: prompt })

  const started = Date.now()
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "user-agent": "opencode-glm-one-arm",
      "HTTP-Referer": "https://github.com/anomalyco/opencode",
      "X-Title": "opencode image-mode test",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content }],
      max_tokens: maxTokens,
      provider: { only: [PIN], allow_fallbacks: false },
    }),
  })
  const raw = await res.text()
  const ms = Date.now() - started
  if (!res.ok) return { status: res.status, content: "", reasoning: "", finish: "http-error", error: raw.slice(0, 400), ms }
  const json = JSON.parse(raw) as {
    choices?: { message?: { content?: string; reasoning?: string }; finish_reason?: string }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
    provider?: string
  }
  const choice = json.choices?.[0]
  return {
    status: res.status,
    content: choice?.message?.content?.trim() ?? "",
    reasoning: choice?.message?.reasoning ?? "",
    finish: choice?.finish_reason ?? "?",
    promptTokens: json.usage?.prompt_tokens,
    completionTokens: json.usage?.completion_tokens,
    provider: json.provider,
    ms,
  }
}

async function main() {
  const stream = readFileSync(MAP, "utf8")
  const truth = JSON.parse(readFileSync(TRUTH, "utf8")) as Truth
  const candidates = filesOnFirstPage(stream, truth)

  const header = [
    "# GLM-5.3-Flash read-back (one arm per run, written incrementally)",
    "",
    `- model \`${MODEL}\`, pinned to \`${PIN}\`, allow_fallbacks=false`,
    `- reasoning is mandatory on this endpoint; budget 16,000 tokens`,
    `- files fully contained on page 1: ${candidates.length}`,
    "",
    "| arm | file | symbols | images | prompt_tok | completion_tok | finish | content | reasoning | named | of |",
    "|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|",
    "",
  ].join("\n")
  writeFileSync(OUT, header)
  console.log(`files on page 1: ${candidates.length}`)

  const pageCount = Number(ARM)
  const images: Buffer[] = []
  for (let i = 1; i <= pageCount; i++) images.push(readFileSync(join(DIR, `page${i}.webp`)))

  // Every candidate gets a question, largest first - several data points per run.
  for (const [file, symbols] of candidates.slice(0, 3)) {
    const prompt =
      `This image set is a symbol map of a codebase, rendered as pixels. ` +
      `List every symbol declared in the file ${file.split("/").pop()}, one per line, as NAME LINE. ` +
      `Output the list and nothing else.`
    const r = await ask(images, prompt)
    const hay = r.content.toLowerCase()
    const hit = symbols.filter((s) => hay.includes(s.name.toLowerCase())).length
    const line = `| ${ARM}p | \`${file.split("/").pop()}\` | ${symbols.length} | ${images.length} | ${r.promptTokens ?? "?"} | ${r.completionTokens ?? "?"} | ${r.finish} | ${r.content.length} | ${r.reasoning.length} | ${hit} | ${((100 * hit) / symbols.length).toFixed(0)}% |`
    appendFileSync(OUT, line + "\n")
    console.log(line)

    appendFileSync(
      OUT,
      `\n<details><summary>${file.split("/").pop()} — content</summary>\n\n\`\`\`\n${r.content.slice(0, 2000)}\n\`\`\`\n</details>\n\n`,
    )
    if (r.error) appendFileSync(OUT, `error: ${r.error}\n\n`)
  }

  const last = candidates[0]
  if (last) {
    appendFileSync(OUT, `\n## ground truth — ${last[0].split("/").pop()}\n\n\`\`\`\n${last[1].map((s) => `${s.name} ${s.line}`).join("\n")}\n\`\`\`\n`)
  }
  console.log("")
  console.log(`written to ${OUT}`)
}

main()
