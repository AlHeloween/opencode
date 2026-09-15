// CONTROL (fixed): 9 frames, targets that are PHYSICALLY INSIDE those 9 frames.
//
// Why the previous control was invalid: it asked about estimateRequestTokens (overflow.ts)
// and EMA_ALPHA (media-token-calibration.ts), but overflow.ts starts at map line 1572 and the
// cut kept only 765 lines. Neither symbol was in the video at all, so the answer "52" was
// invention about absent content - it proved nothing about reading.
//
// The rule this enforces: a question is only valid if its answer is provably inside the
// rendered bytes. This script DERIVES the targets from the cut file itself, so an absent
// target is impossible by construction.
//
// Evidence being tested (same renderer, same geometry 2560x1440 / 85 lines per frame / 1.5s):
//   overflow.ts alone      3 frames -> 2/2 correct   (c5_sweep P2-density)
//   3 files concatenated   9 frames -> 2/2 correct   (c5_sweep batch3)
//   symbol map            85 frames -> 0/4 correct   (today)
// Whether video survives past ~9 frames is the open variable. This pins the 9-frame point on
// the symbol map's own content.
//
// Run: cmd_runner start --cwd experiments/2026-09-12_deepseek-vision -- bun glm-video-control.ts

import fs from "node:fs"
import path from "node:path"

const AUTH = new URL("../../bin/auth.json", import.meta.url)
const key = JSON.parse(fs.readFileSync(AUTH, "utf-8")).openrouter?.key
if (!key) {
  console.error("no openrouter key in bin/auth.json")
  process.exit(1)
}

const DIR = import.meta.dir
const MAP = path.join(DIR, "symbol-map.txt")
const CUT = path.join(DIR, "symbol-map-short.txt")
const SHORT_DIR = path.join(DIR, "symbol-video-short")
const OUT = path.join(DIR, "glm-test", "VIDEO-CONTROL.md")
const LINES_PER_FRAME = 85
const FRAMES = 9

// --- cut the map at exactly the frame boundary -------------------------------------------
const all = fs.readFileSync(MAP, "utf-8").split(/\r?\n/)
const cutLines = all.slice(0, LINES_PER_FRAME * FRAMES)
fs.writeFileSync(CUT, cutLines.join("\n"), "utf-8")

// --- derive targets that live INSIDE the cut ---------------------------------------------
// The map rows look like: "    5   fn user" under a leading "@file" header.
type Target = { q: string; truth: string; where: string; frame: number }

function sectionRows(file: string): Array<{ line: string; kind: string; name: string }> {
  const out: Array<{ line: string; kind: string; name: string }> = []
  const start = cutLines.findIndex((l) => l === `@${file}`)
  if (start < 0) return out
  for (let i = start + 1; i < cutLines.length && !cutLines[i]!.startsWith("@"); i++) {
    const m = cutLines[i]!.match(/^\s+(\d+)[* ]*\s+(\S+)\s+(.*\S)\s*$/)
    if (m) out.push({ line: m[1]!, kind: m[2]!, name: m[3]! })
  }
  return out
}

function frameOfFile(file: string): number {
  const idx = cutLines.findIndex((l) => l === `@${file}`)
  return idx < 0 ? -1 : Math.floor(idx / LINES_PER_FRAME) + 1
}

// Pick, per frame, one file and one unambiguous symbol from it.
const targets: Target[] = []
const seenNames = new Set<string>()
for (const raw of cutLines) {
  const h = raw.match(/^@(.+)$/)
  if (!h) continue
  const file = h[1]!
  const rows = sectionRows(file)
  if (rows.length === 0) continue
  const candidates = rows.filter((r) => !seenNames.has(r.name) && /^[A-Za-z_$][\w$]*$/.test(r.name))
  const pick = candidates[0]
  if (!pick) continue
  seenNames.add(pick.name)
  targets.push({
    q: `the line number shown for the symbol ${pick.name} in ${file}`,
    truth: pick.line,
    where: `map: ${file} -> ${pick.kind} ${pick.name} at line ${pick.line}`,
    frame: frameOfFile(file),
  })
  if (targets.length >= 6) break
}

if (targets.length === 0) {
  console.error("no derivable targets inside the cut - aborting rather than guessing")
  process.exit(1)
}

;["# Video control: 9 frames, targets verified inside the video", ""].forEach((l) => fs.writeFileSync(OUT, l + "\n", "utf-8"))
const say = (line = "") => {
  console.log(line)
  fs.appendFileSync(OUT, line + "\n", "utf-8")
}

// --- render -------------------------------------------------------------------------------
const root = path.join(DIR, "..", "..")
const proc = Bun.spawn(
  [
    "bun",
    path.join(root, "experiments", "2026-09-08_render-text-video", "render_text_video.mts"),
    "experiments/2026-09-12_deepseek-vision/symbol-map-short.txt",
    "experiments/2026-09-12_deepseek-vision/symbol-video-short",
    String(LINES_PER_FRAME),
    "13",
    "1.5",
    "2560",
    "1440",
  ],
  { cwd: root, stdout: "pipe", stderr: "pipe", stdin: "ignore" },
)
const [rout, rerr, rcode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
])
if (rcode !== 0) {
  console.error("render failed:", rerr.slice(-400))
  process.exit(1)
}
const meta = JSON.parse(rout) as { frames: number; bytes: number; seconds: number }

say(`- cut: ${cutLines.length} lines (${FRAMES} frames x ${LINES_PER_FRAME})`)
say(`- video: ${meta.frames} frames, ${(meta.bytes / 1048576).toFixed(2)} MiB, ${meta.seconds}s`)
say(`- reference: overflow.ts 3 frames -> 2/2 OK, batch3 9 frames -> 2/2 OK, full map 85 frames -> 0/4`)
say(`- every target below was DERIVED from the cut, so it is provably inside the video`)
say("")

async function probe(question: string): Promise<{ answer: string; usage: Record<string, unknown> }> {
  const b64 = fs.readFileSync(path.join(SHORT_DIR, "text_video.mp4")).toString("base64")
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
  if (payload.error) return { answer: `ERROR: ${JSON.stringify(payload.error).slice(0, 200)}`, usage: {} }
  return {
    answer: payload.choices?.[0]?.message?.content?.trim() ?? "(null - reasoning loop)",
    usage: payload.usage ?? {},
  }
}

const matches = (answer: string, expected: string) =>
  new RegExp(`(?<![0-9A-Za-z_.])${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9A-Za-z_])`).test(answer)

const rows: Array<Record<string, unknown>> = []
for (const t of targets) {
  const started = Date.now()
  const r = await probe(t.q)
  const usage = r.usage as { prompt_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } }
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  const ok = matches(String(r.answer), t.truth)
  rows.push({ ...t, answer: r.answer, ok, reasoning })
  say(`## frame ${t.frame}: ${t.q}`)
  say("")
  say(`- truth: \`${t.truth}\`  (${t.where})`)
  say(`- answered: \`${String(r.answer).slice(0, 200)}\``)
  say(`- ${ok ? "**CORRECT**" : "**WRONG**"} | prompt ${usage.prompt_tokens} reasoning ${reasoning} | ${Math.round((Date.now() - started) / 1000)}s`)
  say("")
}

const hits = rows.filter((r) => r.ok).length
say("## Summary")
say("")
say("| frame | question | truth | answer | result |")
say("|---:|---|---|---|---|")
for (const r of rows) {
  say(`| ${r.frame} | ${r.q} | ${r.truth} | ${String(r.answer).slice(0, 40)} | ${r.ok ? "OK" : "MISS"} |`)
}
say("")
say(`**${hits}/${rows.length} correct at ${meta.frames} frames**`)
say("")
say(
  hits === 0
    ? "Verdict: video fails on this content class even at the size that worked for source code."
    : "Verdict: video reads symbol-map content; the 85-frame map exceeded what the provider samples.",
)
