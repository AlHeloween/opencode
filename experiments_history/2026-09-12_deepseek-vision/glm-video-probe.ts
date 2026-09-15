// Symbol map as VIDEO - the replacement for 20 images, using the pattern that already
// scored 9/9 on 2026-09-07 (experiments/2026-09-07_deliver-once-media-smoke/c5_sweep.mts).
//
// Why video and not 20 image blocks:
//   * 20 image blocks scored 0/2 twice (DeepSeek, then GLM). The failure followed the image
//     count, not the renderer.
//   * video_url carries the SAME frames as ONE content block, so nothing can be diluted
//     across blocks.
//   * c5_sweep.mts header records the trap: "One short question per call (multi-question
//     prompts trip GLM reasoning loops - measured 2026-09-07)". A previous run of mine asked
//     three questions in one prompt and burned 30,583 chars of reasoning with content=0.
//
// The questions come from derive-video-truth.ts, which computes every answer from the map's
// own bytes. That matters: the first attempt asked for the VALUE of two constants, but the
// map carries names, kinds and line numbers only - it holds no values at all, so those two
// questions were unanswerable and their answers were invention, not reading.
//
// One question per call. max_tokens 16384: reasoning is mandatory and spends ~1,500-11,000
// before any answer is emitted.
//
// Run: cmd_runner start --cwd experiments/2026-09-12_deepseek-vision -- bun glm-video-probe.ts

import fs from "node:fs"
import path from "node:path"

const AUTH = new URL("../../bin/auth.json", import.meta.url)
const key = JSON.parse(fs.readFileSync(AUTH, "utf-8")).openrouter?.key
if (!key) {
  console.error("no openrouter key found in bin/auth.json")
  process.exit(1)
}

const DIR = import.meta.dir
// vid3 is the render produced by render-fixed.ts: monospaced font applied, and the frame is
// verified NOT clipped (bottomGapPx 124 vs 1 in the broken render). The earlier runs used
// symbol-video/text_video.mp4, whose frames were cut off at the bottom edge - the model was
// asked about lines that were never drawn.
const VIDEO = path.join(DIR, "vid3", "text_video.mp4")
const TRUTH = path.join(DIR, "video-truth.json")
const OUT = path.join(DIR, "glm-test", "VIDEO.md")

const truth = JSON.parse(fs.readFileSync(TRUTH, "utf-8")) as {
  lines: number
  questions: Array<{ q: string; truth: string; where: string }>
}

// Incremental write: the report survives any interruption. The earlier harness buffered and
// lost everything when the process was killed mid-run.
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, "", "utf-8")
const say = (line = "") => {
  console.log(line)
  fs.appendFileSync(OUT, line + "\n", "utf-8")
}

async function probe(question: string): Promise<{ answer: string; usage: Record<string, unknown> }> {
  const b64 = fs.readFileSync(VIDEO).toString("base64")
  const prompt =
    "The video shows pages of a symbol map of TypeScript source files. " +
    `After reading, reply with one short line: ${question} and nothing else.`
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(420_000),
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
    }),
  })
  const payload = (await response.json()) as {
    error?: unknown
    usage?: Record<string, unknown>
    choices?: Array<{ message?: { content?: string } }>
  }
  if (payload.error) {
    return { answer: `ERROR: ${JSON.stringify(payload.error).slice(0, 300)}`, usage: payload.usage ?? {} }
  }
  return {
    answer: payload.choices?.[0]?.message?.content?.trim() ?? "(null - reasoning loop)",
    usage: payload.usage ?? {},
  }
}

/** Standalone-token match, so "0.2" can never satisfy "0.3" and "16" never satisfies "6". */
function matches(answer: string, expected: string): boolean {
  return new RegExp(`(?<![0-9A-Za-z_.])${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9A-Za-z_])`).test(answer)
}

const stat = fs.statSync(VIDEO)
say("# Symbol map as video")
say("")
say("- model: z-ai/glm-5.3-flash (OpenRouter, no provider pin)")
say(`- video: ${(stat.size / 1048576).toFixed(2)} MiB, ONE video_url block, 85 frames / 127s`)
say("- max_tokens: 16384, ONE question per call")
say(`- symbol map: 132 files, 3060 symbols, 7797 edges, 260663 chars, ${truth.lines} lines`)
say("- truth for every question is computed from the map itself by derive-video-truth.ts")
say("")

const rows: Array<Record<string, unknown>> = []

for (const item of truth.questions) {
  const started = Date.now()
  const r = await probe(item.q)
  const usage = r.usage as {
    prompt_tokens?: number
    completion_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
    cost?: number
  }
  const ok = matches(String(r.answer), item.truth)
  rows.push({
    question: item.q,
    truth: item.truth,
    answer: r.answer,
    correct: ok,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    cost: usage.cost,
    seconds: Math.round((Date.now() - started) / 1000),
  })
  say(`## ${item.q}`)
  say("")
  say(`- truth: \`${item.truth}\` (${item.where})`)
  say(`- answered: \`${String(r.answer).slice(0, 300)}\``)
  say(
    `- ${ok ? "**CORRECT**" : "**WRONG**"} | prompt ${usage.prompt_tokens} reasoning ${usage.completion_tokens_details?.reasoning_tokens} completion ${usage.completion_tokens} | ${Math.round((Date.now() - started) / 1000)}s`,
  )
  say("")
}

const hits = rows.filter((r) => r.correct).length
say("## Summary")
say("")
say("| question | truth | answer | result | reasoning tok |")
say("|---|---|---|---|---:|")
for (const r of rows) {
  say(
    `| ${r.question} | ${r.truth} | ${String(r.answer).slice(0, 50)} | ${r.correct ? "OK" : "MISS"} | ${r.reasoningTokens ?? "-"} |`,
  )
}
say("")
say(`**${hits}/${rows.length} correct**`)
