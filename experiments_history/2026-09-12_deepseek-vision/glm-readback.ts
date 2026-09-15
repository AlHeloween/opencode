// GLM-5.3-Flash read-back. Rewritten to survive interruption.
//
// Defects in the previous attempts, and what changed:
//   1. the answer buffer was flushed to disk only at the end, so any crash lost everything.
//      -> now every event is appended to READBACK.md immediately.
//   2. three overlapping runs wrote the same file. -> a run id is written into the file and
//      the script refuses to run if another run is already marked active.
//   3. max_tokens was too small: reasoning is mandatory on this endpoint and spends
//      1,700-2,000 tokens before any content. Verified: finish_reason=length with content=""
//      at 1,500, and finish_reason=stop at 1,024+ for a short question.
//      -> MAX_TOKENS is 16,000 and finish_reason is recorded per call.
//   4. one shot at a time: the long call is what killed the process before.
//      -> arms and questions are separate calls, each flushed on completion.
//
// Model: z-ai/glm-5.3-flash pinned to provider "z-ai" (allow_fallbacks=false).
// Task: read a codegraph symbol map rendered as pixels, answer code questions.
//
// Run: cmd_runner start --cwd experiments/2026-09-12_deepseek-vision -- bun glm-readback.ts

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "glm-test")
const OUT = join(DIR, "READBACK.md")
const LOCK = join(DIR, "RUNNING.lock")
const MAP = join(import.meta.dir, "symbol-map.txt")
const TRUTH = join(import.meta.dir, "symbol-map-truth.json")
const URL = "https://openrouter.ai/api/v1/chat/completions"
const MODEL = process.env.GLM_MODEL ?? "z-ai/glm-5.3-flash"
const PIN = process.env.GLM_PROVIDER ?? "z-ai"
const MAX_TOKENS = 16_000

mkdirSync(DIR, { recursive: true })

// --- single-run guard ---------------------------------------------------------
if (existsSync(LOCK)) {
  const info = readFileSync(LOCK, "utf8")
  const age = Date.now() - Number(info.split(" ")[1] ?? 0)
  if (age < 30 * 60 * 1000) {
    console.error(`another run appears active (${info.trim()}); refusing to start`)
    process.exit(2)
  }
}
const RUN_ID = `${new Date().toISOString()} pid=${process.pid}`
writeFileSync(LOCK, `${RUN_ID} ${Date.now()}`, "utf8")

function say(line = "") {
  console.log(line)
  appendFileSync(OUT, line + "\n", "utf8")
}

process.on("exit", () => {
  try {
    writeFileSync(LOCK, `finished ${Date.now()}`, "utf8")
  } catch {
    /* the lock is advisory */
  }
})

function loadKey(): string {
  const env = process.env.OPENROUTER_API_KEY?.trim()
  if (env) return env
  const auth = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "bin", "auth.json"), "utf8"))
  return String(auth.openrouter.key).trim()
}

const KEY = loadKey()

type Result = {
  status: number
  content: string
  reasoning: string
  promptTokens?: number
  completionTokens?: number
  finish?: string
  provider?: string
  error?: string
}

let callNo = 0

async function ask(images: Buffer[], prompt: string): Promise<Result> {
  callNo++
  say(`\n<!-- call ${callNo} ${new Date().toISOString()} -->`)
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
      "user-agent": "opencode-glm-readback",
      "HTTP-Referer": "https://github.com/anomalyco/opencode",
      "X-Title": "opencode image-mode test",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content }],
      max_tokens: MAX_TOKENS,
      provider: { only: [PIN], allow_fallbacks: false },
    }),
  })
  const raw = await res.text()
  const ms = Date.now() - started

  if (!res.ok) {
    say(`- HTTP ${res.status} after ${ms}ms: ${raw.slice(0, 300)}`)
    return { status: res.status, content: "", reasoning: "", error: raw.slice(0, 300) }
  }

  const json = JSON.parse(raw) as {
    choices?: { message?: { content?: string; reasoning?: string }; finish_reason?: string }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
    provider?: string
  }
  const choice = json.choices?.[0]
  const result: Result = {
    status: res.status,
    content: choice?.message?.content?.trim() ?? "",
    reasoning: choice?.message?.reasoning ?? "",
    promptTokens: json.usage?.prompt_tokens,
    completionTokens: json.usage?.completion_tokens,
    finish: choice?.finish_reason,
    provider: json.provider,
  }
  say(
    `- HTTP ${result.status} in ${ms}ms | provider ${result.provider ?? "?"} | prompt ${result.promptTokens} | completion ${result.completionTokens} | finish ${result.finish} | content ${result.content.length} chars | reasoning ${result.reasoning.length} chars`,
  )
  return result
}

type Truth = {
  file_list: string[]
  symbols_by_file: Record<string, { name: string; kind: string; line: number; exported: boolean }[]>
}

async function main() {
  const stream = readFileSync(MAP, "utf8")
  const truth = JSON.parse(readFileSync(TRUTH, "utf8")) as Truth

  writeFileSync(
    OUT,
    [
      `# GLM-5.3-Flash read-back (run ${RUN_ID})`,
      "",
      `- model: ${MODEL}, pinned to "${PIN}", allow_fallbacks=false`,
      `- max_tokens: ${MAX_TOKENS} (reasoning mandatory, spends ~1,700-2,000 first)`,
      `- map: ${truth.file_list.length} files, ${stream.length} chars`,
      "",
    ].join("\n"),
    "utf8",
  )

  const pages = [1, 2, 3, 4, 5]
    .map((n) => join(DIR, `page${n}.webp`))
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p))

  const entries = Object.entries(truth.symbols_by_file).sort((a, b) => b[1].length - a[1].length)
  const [targetFile, targetSymbols] = entries[0]!
  const smallFile = Object.entries(truth.symbols_by_file).filter(([, s]) => s.length >= 3 && s.length <= 6)[0]!

  say(`pages on disk: ${pages.length}`)
  say(`largest file: \`${targetFile}\` (${targetSymbols.length} symbols)`)
  say(`small file:   \`${smallFile[0]}\` (${smallFile[1].length} symbols)`)

  // --- Q1: the file with the most symbols, page 1 only (content IS on page 1) ----
  say("\n## Q1 - symbols of `" + targetFile + "`, page 1 only\n")
  const q1 = await ask(
    [pages[0]!],
    `This image is a symbol map of a codebase. List every symbol declared in the file ${targetFile}, ` +
      `one per line as NAME LINE. Output only the list.`,
  )
  const hit1 = targetSymbols.filter((s) => q1.content.toLowerCase().includes(s.name.toLowerCase())).length
  say(`\n**Q1 result: ${hit1}/${targetSymbols.length} symbols named (${((100 * hit1) / targetSymbols.length).toFixed(0)}%)**\n`)
  say("```")
  say(q1.content.slice(0, 3000) || "(empty)")
  say("```")
  say("\ntruth:")
  say("```")
  say(targetSymbols.map((s) => `${s.name} ${s.line}`).join("\n"))
  say("```")

  // --- Q2: a small file, four pages in context (dilution check) -----------------
  say("\n## Q2 - symbols of `" + smallFile[0] + "`, pages 1-4 in context\n")
  const q2 = await ask(
    pages.slice(0, 4),
    `This image set is a symbol map of a codebase. List every symbol declared in the file ${smallFile[0]}, ` +
      `one per line as NAME LINE. Output only the list.`,
  )
  const hit2 = smallFile[1].filter((s) => q2.content.toLowerCase().includes(s.name.toLowerCase())).length
  say(`\n**Q2 result: ${hit2}/${smallFile[1].length} symbols named (${((100 * hit2) / smallFile[1].length).toFixed(0)}%)**\n`)
  say("```")
  say(q2.content.slice(0, 2000) || "(empty)")
  say("```")
  say("\ntruth:")
  say("```")
  say(smallFile[1].map((s) => `${s.name} ${s.line}`).join("\n"))
  say("```")

  // --- Q3: does it read a value, not just names ---------------------------------
  say("\n## Q3 - exact line number of a specific symbol\n")
  const probe = targetSymbols[Math.floor(targetSymbols.length / 2)]!
  const q3 = await ask(
    [pages[0]!],
    `In this symbol map, what is the line number of the symbol ${probe.name} in the file ${targetFile}? ` +
      `Answer with the number only.`,
  )
  const nums = [...q3.content.matchAll(/\b(\d{1,5})\b/g)].map((m) => Number(m[1]))
  const numeric = nums.some((n) => Math.abs(n - probe.line) <= 1)
  say(`\n**Q3 result: asked ${probe.name} -> truth ${probe.line}, answered "${q3.content.slice(0, 60)}", ${numeric ? "CORRECT" : "WRONG"}**\n`)

  say("\n## Summary")
  say("")
  say(`| question | scope | named | of | pct |`)
  say(`|---|---|---:|---:|---:|`)
  say(`| Q1 ${targetFile} | page 1 only | ${hit1} | ${targetSymbols.length} | ${((100 * hit1) / targetSymbols.length).toFixed(0)}% |`)
  say(`| Q2 ${smallFile[0]} | pages 1-4 | ${hit2} | ${smallFile[1].length} | ${((100 * hit2) / smallFile[1].length).toFixed(0)}% |`)
  say(`| Q3 exact line | page 1 only | ${numeric ? 1 : 0} | 1 | ${numeric ? 100 : 0}% |`)

  console.log("\nDONE")
}

main().catch((error) => {
  say(`\n**FAILED: ${String(error).slice(0, 400)}**`)
  process.exit(1)
})
