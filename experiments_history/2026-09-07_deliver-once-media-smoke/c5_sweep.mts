// C5 P2 sweep (2026-09-08): density/accuracy curve + batch диафильм + duration A/B.
// Densities 40/70/85 lines-per-frame (55 already measured), two ground-truth
// questions per density (shallow frame-0 constant + deep later-frame constant),
// then a 3-file batch video with a cross-file question, then the same batch at
// 2x frame duration (duration-vs-content cost A/B).
// One short question per call (multi-question prompts trip GLM reasoning loops
// — measured 2026-09-07). Never prints the API key.
import fs from "fs"

const AUTH = new URL("../../bin/auth.json", import.meta.url)
const key = JSON.parse(fs.readFileSync(AUTH, "utf-8")).openrouter?.key
if (!key) {
  console.error("no openrouter key found in bin/auth.json")
  process.exit(1)
}

async function render(args: string[]) {
  const proc = Bun.spawn(["bun", "experiments/2026-09-08_render-text-video/render_text_video.mts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`render failed: ${err.slice(-500)}`)
  return JSON.parse(out)
}

async function probe(videoPath: string, question: string) {
  const b64 = fs.readFileSync(videoPath).toString("base64")
  const prompt =
    "The video shows a few pages of TypeScript source code. " +
    `After reading, reply with one short line: ${question} and nothing else.`
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
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
  const payload = await response.json()
  if (payload.error) return { answer: `ERROR: ${JSON.stringify(payload.error).slice(0, 120)}`, usage: payload.usage }
  return {
    answer: payload.choices?.[0]?.message?.content?.trim() ?? "(null — reasoning loop)",
    usage: payload.usage,
  }
}

const SRC = "packages/opencode/src/session/overflow.ts"
const QUESTIONS: Array<{ q: string; truth: string; depth: string }> = [
  { q: "the numeric value of the constant CHARS_PER_TOKEN", truth: "4", depth: "frame-0" },
  { q: "the numeric value of the constant SUMMARY_GENERATION_RESERVE_TOKENS", truth: "32768", depth: "deep" },
]

const rows: Array<Record<string, unknown>> = []

// --- P2: density sweep (55 already measured manually) ---
for (const [lines, fontSize] of [
  [40, 24],
  [70, 15],
  [85, 13],
] as const) {
  const dir = `experiments/2026-09-08_render-text-video/sweep_${lines}`
  const meta = await render([SRC, dir, String(lines), String(fontSize), "1.5", "2560", "1440"])
  console.log(`rendered ${lines} lines/frame: ${meta.frames} frames, ${(meta.bytes / 1024).toFixed(0)} KB, ${meta.seconds}s`)
  for (const item of QUESTIONS) {
    const r = await probe(`${dir}/text_video.mp4`, item.q)
    const usage = r.usage ?? {}
    const ok = String(r.answer).includes(item.truth)
    rows.push({
      probe: "P2-density",
      linesPerFrame: lines,
      depth: item.depth,
      truth: item.truth,
      answer: r.answer,
      correct: ok,
      promptTokens: usage.prompt_tokens,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
      cost: usage.cost,
    })
    console.log(`  [${lines}lpf ${item.depth}] "${r.answer}" ${ok ? "OK" : "MISS"} (prompt ${usage.prompt_tokens}, reasoning ${usage.completion_tokens_details?.reasoning_tokens})`)
  }
}

// --- Batch диафильм: 3 files in one video ---
const batchDir = "experiments/2026-09-08_render-text-video/batch3"
const batchSources = [
  "packages/opencode/src/session/overflow.ts",
  "packages/opencode/src/session/token-calibration.ts",
  "packages/opencode/src/session/media-token-calibration.ts",
]
let concat = ""
for (const f of batchSources) {
  concat += `\n// ===== FILE: ${f} =====\n` + fs.readFileSync(f, "utf-8")
}
fs.writeFileSync("experiments/2026-09-08_render-text-video/batch3_src.ts", concat)
const BATCH_LINES = 55
const batchMeta = await render([
  "experiments/2026-09-08_render-text-video/batch3_src.ts",
  batchDir,
  String(BATCH_LINES),
  "17",
  "2", // 2s/frame → duration point A
  "2560",
  "1440",
])
console.log(`batch диафильм: ${batchMeta.frames} frames, ${batchMeta.seconds}s, ${(batchMeta.bytes / 1024).toFixed(0)} KB`)

const batchQuestions: Array<{ q: string; truth: string; file: string }> = [
  { q: "the numeric value of the constant CHARS_PER_TOKEN", truth: "4", file: "overflow.ts" },
  { q: "the numeric value of the constant EMA_ALPHA", truth: "0.3", file: "media-token-calibration.ts" },
]
for (const item of batchQuestions) {
  const r = await probe(`${batchDir}/text_video.mp4`, item.q)
  const usage = r.usage ?? {}
  const ok = String(r.answer).includes(item.truth)
  rows.push({
    probe: "batch-3files",
    depth: `cross-file:${item.file}`,
    truth: item.truth,
    answer: r.answer,
    correct: ok,
    promptTokens: usage.prompt_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    cost: usage.cost,
  })
  console.log(`  [batch ${item.file}] "${r.answer}" ${ok ? "OK" : "MISS"} (prompt ${usage.prompt_tokens})`)
}

// --- Duration A/B: same content, 4s/frame (≈2x duration) ---
const slowDir = "experiments/2026-09-08_render-text-video/batch3_slow"
const slowMeta = await render([
  "experiments/2026-09-08_render-text-video/batch3_src.ts",
  slowDir,
  String(BATCH_LINES),
  "17",
  "4", // 4s/frame → duration point B (2x)
  "2560",
  "1440",
])
console.log(`batch slow: ${slowMeta.frames} frames, ${slowMeta.seconds}s`)
{
  const r = await probe(`${slowDir}/text_video.mp4`, batchQuestions[0]!.q)
  const usage = r.usage ?? {}
  rows.push({
    probe: "duration-AB",
    depth: `${slowMeta.seconds}s vs ${batchMeta.seconds}s`,
    truth: batchQuestions[0]!.truth,
    answer: r.answer,
    correct: String(r.answer).includes(batchQuestions[0]!.truth),
    promptTokens: usage.prompt_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    cost: usage.cost,
  })
  console.log(`  [slow ${slowMeta.seconds}s] "${r.answer}" (prompt ${usage.prompt_tokens} vs ${batchMeta.seconds}s point)`)
}

fs.writeFileSync("experiments/2026-09-07_deliver-once-media-smoke/c5_sweep_results.json", JSON.stringify(rows, null, 2))
console.log("\n=== TABLE ===")
console.table(rows)
