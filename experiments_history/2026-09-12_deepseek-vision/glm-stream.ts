// GLM-5.3-Flash read-back, streaming with a hard timeout.
//
// Root causes of the previous hangs, both mine:
//   1. `fetch` had NO timeout, so a stalled request blocked forever with nothing on disk.
//   2. the question asked for all 174 symbols of one file; with mandatory reasoning that is a
//      very long generation, and nothing was written until it finished.
//
// Fixes:
//   * AbortSignal.timeout(420_000) - a stalled call dies instead of hanging the run
//   * streaming (stream: true) - text arrives incrementally and is appended to the report as it
//     comes, so partial evidence survives any interruption
//   * the question asks for a bounded span (the first 25 symbols) instead of an unbounded list
//   * every SSE event that carries content or reasoning is counted, so "thinking" and "answering"
//     are distinguishable while it runs
//
// Model: z-ai/glm-5.3-flash pinned to provider "z-ai" (allow_fallbacks=false).
//
// Run: cmd_runner start --cwd experiments/2026-09-12_deepseek-vision -- bun glm-stream.ts

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "glm-test")
const OUT = join(DIR, "STREAM.md")
const MAP = join(import.meta.dir, "symbol-map.txt")
const TRUTH = join(import.meta.dir, "symbol-map-truth.json")
const URL = "https://openrouter.ai/api/v1/chat/completions"
const MODEL = process.env.GLM_MODEL ?? "z-ai/glm-5.3-flash"
const PIN = process.env.GLM_PROVIDER ?? "z-ai"
const MAX_TOKENS = 32_000
const TIMEOUT_MS = 420_000

mkdirSync(DIR, { recursive: true })

let first = true
function say(line = "") {
  console.log(line)
  appendFileSync(OUT, line + "\n", "utf8")
}

function loadKey(): string {
  const env = process.env.OPENROUTER_API_KEY?.trim()
  if (env) return env
  const auth = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "bin", "auth.json"), "utf8"))
  return String(auth.openrouter.key).trim()
}

const KEY = loadKey()

type Outcome = {
  content: string
  reasoning: string
  promptTokens?: number
  completionTokens?: number
  finish?: string
  provider?: string
  status: number
  ms: number
  error?: string
}

async function askStream(images: Buffer[], prompt: string): Promise<Outcome> {
  const content: unknown[] = images.map((b) => ({
    type: "image_url",
    image_url: { url: `data:image/webp;base64,${b.toString("base64")}` },
  }))
  content.push({ type: "text", text: prompt })

  const started = Date.now()
  let answer = ""
  let thinking = ""
  let finish: string | undefined
  let promptTokens: number | undefined
  let completionTokens: number | undefined
  let provider: string | undefined
  let lastFlush = 0
  let status = 0

  try {
    const res = await fetch(URL, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        "user-agent": "opencode-glm-stream",
        "HTTP-Referer": "https://github.com/anomalyco/opencode",
        "X-Title": "opencode image-mode test",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content }],
        max_tokens: MAX_TOKENS,
        stream: true,
        provider: { only: [PIN], allow_fallbacks: false },
      }),
    })

    status = res.status

    if (!res.ok) {
      const body = await res.text()
      say(`- HTTP ${res.status}: ${body.slice(0, 300)}`)
      return { content: "", reasoning: "", status: res.status, ms: Date.now() - started, error: body.slice(0, 300) }
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split("\n\n")
      buffer = frames.pop() ?? ""

      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data:"))
        if (!line) continue
        const payload = line.slice(5).trim()
        if (payload === "[DONE]") continue
        let event: {
          choices?: { delta?: { content?: string; reasoning?: string }; finish_reason?: string }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number }
          provider?: string
        }
        try {
          event = JSON.parse(payload)
        } catch {
          continue
        }
        if (event.provider) provider = event.provider
        if (event.usage) {
          promptTokens = event.usage.prompt_tokens
          completionTokens = event.usage.completion_tokens
        }
        const choice = event.choices?.[0]
        if (!choice) continue
        if (choice.delta?.reasoning) thinking += choice.delta.reasoning
        if (choice.delta?.content) answer += choice.delta.content
        if (choice.finish_reason) finish = choice.finish_reason

        // progress heartbeat so the run is visibly alive
        const now = Date.now()
        if (now - lastFlush > 15_000) {
          lastFlush = now
          say(`  … ${Math.round((now - started) / 1000)}s: reasoning ${thinking.length} chars, content ${answer.length} chars`)
        }
      }
    }
  } catch (error) {
    const message = String(error)
    say(`- ABORTED/ERROR after ${Math.round((Date.now() - started) / 1000)}s: ${message.slice(0, 200)}`)
    return {
      content: answer,
      reasoning: thinking,
      promptTokens,
      completionTokens,
      finish,
      provider,
      status: 0,
      ms: Date.now() - started,
      error: message.slice(0, 200),
    }
  }

  return {
    content: answer.trim(),
    reasoning: thinking,
    promptTokens,
    completionTokens,
    finish,
    provider,
    status,
    ms: Date.now() - started,
  }
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
      `# GLM-5.3-Flash streaming read-back`,
      "",
      `- model: ${MODEL}, pinned to "${PIN}", allow_fallbacks=false`,
      `- max_tokens: ${MAX_TOKENS}, hard timeout: ${TIMEOUT_MS / 1000}s, streaming: yes`,
      `- map: ${truth.file_list.length} files, ${stream.length} chars`,
      "",
    ].join("\n"),
    "utf8",
  )

  const entries = Object.entries(truth.symbols_by_file).sort((a, b) => b[1].length - a[1].length)
  const [bigFile, bigSymbols] = entries[0]!
  const [smallFile, smallSymbols] = entries[entries.length - 1]!

  const page1 = join(DIR, "page1.webp")
  const pages14 = [1, 2, 3, 4].map((n) => join(DIR, `page${n}.webp`)).filter((p) => existsSync(p))
  say(`biggest file : \`${bigFile}\` (${bigSymbols.length} symbols)`)
  say(`smallest file: \`${smallFile}\` (${smallSymbols.length} symbols)`)
  say("")

  // --- Q1: bounded ask on page 1 -------------------------------------------------
  say(`## Q1 - first 25 symbols of \`${bigFile}\` (page 1)\n`)
  const q1 = await askStream(
    [readFileSync(page1)],
    `This image is a symbol map of a codebase, rendered as pixels. ` +
      `List the FIRST 25 symbols declared in the file ${bigFile}, one per line as NAME LINE, ` +
      `in the order they appear. Output only the list.`,
  )
  const first25 = bigSymbols.slice(0, 25)
  const hit1 = first25.filter((s) => q1.content.toLowerCase().includes(s.name.toLowerCase())).length
  say(`\n**Q1: ${hit1}/${first25.length} (${((100 * hit1) / first25.length).toFixed(0)}%) | finish=${q1.finish} | prompt=${q1.promptTokens} completion=${q1.completionTokens} | ${(q1.ms / 1000).toFixed(0)}s**\n`)
  say("```")
  say(q1.content.slice(0, 2000) || "(empty)")
  say("```")
  say("\ntruth (first 25):")
  say("```")
  say(first25.map((s) => `${s.name} ${s.line}`).join("\n"))
  say("```")

  // --- Q2: small file, four pages in context -------------------------------------
  say(`\n## Q2 - all symbols of \`${smallFile}\` (pages 1-4 in context)\n`)
  const q2 = await askStream(
    pages14.map((p) => readFileSync(p)),
    `This image set is a symbol map of a codebase. List EVERY symbol declared in the file ` +
      `${smallFile}, one per line as NAME LINE. Output only the list.`,
  )
  const hit2 = smallSymbols.filter((s) => q2.content.toLowerCase().includes(s.name.toLowerCase())).length
  say(`\n**Q2: ${hit2}/${smallSymbols.length} (${((100 * hit2) / smallSymbols.length).toFixed(0)}%) | finish=${q2.finish} | prompt=${q2.promptTokens} completion=${q2.completionTokens} | ${(q2.ms / 1000).toFixed(0)}s**\n`)
  say("```")
  say(q2.content.slice(0, 1500) || "(empty)")
  say("```")
  say("\ntruth:")
  say("```")
  say(smallSymbols.map((s) => `${s.name} ${s.line}`).join("\n"))
  say("```")

  // --- Q3: an exact value, not a name --------------------------------------------
  const probe = bigSymbols[Math.floor(bigSymbols.length / 2)]!
  say(`\n## Q3 - exact line of \`${probe.name}\` in \`${bigFile}\`\n`)
  const q3 = await askStream(
    [readFileSync(page1)],
    `In this symbol map, what is the line number of the symbol ${probe.name} in the file ${bigFile}? ` +
      `Answer with the number only.`,
  )
  const nums = [...q3.content.matchAll(/\b(\d{1,5})\b/g)].map((m) => Number(m[1]))
  const ok3 = nums.some((n) => Math.abs(n - probe.line) <= 1)
  say(`\n**Q3: truth ${probe.line}, answered "${q3.content.slice(0, 40)}", ${ok3 ? "CORRECT" : "WRONG"} | finish=${q3.finish} | ${(q3.ms / 1000).toFixed(0)}s**\n`)

  say("\n## Summary")
  say("")
  say("| question | scope | correct | of | pct | finish | prompt tok | completion tok |")
  say("|---|---|---:|---:|---:|---|---:|---:|")
  say(`| Q1 first 25 of ${bigFile} | page 1 | ${hit1} | ${first25.length} | ${((100 * hit1) / first25.length).toFixed(0)}% | ${q1.finish} | ${q1.promptTokens} | ${q1.completionTokens} |`)
  say(`| Q2 all of ${smallFile} | pages 1-4 | ${hit2} | ${smallSymbols.length} | ${((100 * hit2) / smallSymbols.length).toFixed(0)}% | ${q2.finish} | ${q2.promptTokens} | ${q2.completionTokens} |`)
  say(`| Q3 exact line ${probe.name} | page 1 | ${ok3 ? 1 : 0} | 1 | ${ok3 ? 100 : 0}% | ${q3.finish} | ${q3.promptTokens} | ${q3.completionTokens} |`)

  console.log("\nDONE")
}

main().catch((error) => {
  say(`\n**FAILED: ${String(error).slice(0, 400)}**`)
  process.exit(1)
})
