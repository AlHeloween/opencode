// Read-back test for the sharp-rendered pages: the oracle for the in-product renderer.
//
// The Python prototype was proven readable; sharp rasterises differently (font fallback,
// hinting, antialiasing), so its output must be verified on the wire before any product
// work. Sends the three sharp-rendered pages as one multi-image request and asks the same
// exact-set question used throughout:
//
//   gate set must equal {G0..G9}   - a continued series (G0..G35) fails the check
//
// Also measures ink coverage per glyph via sharp's own statistics, so a render that
// silently produced empty pages is caught locally rather than blamed on the model.
//
// Run: bun experiments/2026-09-12_deepseek-vision/sharp-verify.ts

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "sharp-out")
const URL = "https://api.deepseek.com/chat/completions"
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-flash"
const CELLS = 160 * 84

function loadKey(): string {
  const env = process.env.DEEPSEEK_API_KEY?.trim()
  if (env) return env
  const auth = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "bin", "auth.json"), "utf8"))
  if (auth?.deepseek?.key) return String(auth.deepseek.key)
  throw new Error("no deepseek key")
}

const KEY = loadKey()

async function inkStats(path: string): Promise<{ inkPct: number; nonWhite: number }> {
  const { default: sharp } = await import("sharp")
  const image = sharp(path).greyscale()
  const { width, height } = await image.metadata()
  const raw = await image.raw().toBuffer()
  let nonWhite = 0
  for (const v of raw) if (v < 128) nonWhite++
  return { inkPct: Number(((100 * nonWhite) / (width! * height!)).toFixed(2)), nonWhite }
}

async function ask(images: Buffer[], prompt: string): Promise<{ text: string; tokens?: number }> {
  const content: unknown[] = images.map((buf) => ({
    type: "image_url",
    image_url: { url: `data:image/webp;base64,${buf.toString("base64")}` },
  }))
  content.push({ type: "text", text: prompt })

  const res = await fetch(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "user-agent": "opencode-sharp-verify",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content }],
      max_tokens: 400,
      thinking: { type: "disabled" },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    return { text: `HTTP ${res.status}: ${body.slice(0, 250)}` }
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number } }
  return { text: json.choices?.[0]?.message?.content?.trim() ?? "", tokens: json.usage?.prompt_tokens }
}

function gates(text: string): number[] {
  return [...text.matchAll(/\bG(\d+)\b/g)].map((m) => Number(m[1])).sort((a, b) => a - b)
}

async function main() {
  const files = readdirSync(DIR)
    .filter((f) => f.startsWith("doc-page") && f.endsWith(".webp"))
    .sort()
  console.log(`pages: ${files.join(", ")}`)
  console.log("")

  const buffers: Buffer[] = []
  for (const file of files) {
    const path = join(DIR, file)
    const buf = readFileSync(path)
    const stats = await inkStats(path)
    buffers.push(buf)
    console.log(`${file.padEnd(16)} ${String(buf.length).padStart(7)} B | ink ${String(stats.inkPct).padStart(5)}% | ${stats.nonWhite} px`)
  }
  console.log(`total ${buffers.reduce((a, b) => a + b.length, 0)} B`)
  console.log("")

  const checks: [string, string, (t: string) => boolean][] = [
    [
      "gates == G0..G9",
      "This image contains a specification document rendered as pixels. List every gate identifier it defines, one line, identifiers only.",
      (t) => {
        const set = gates(t)
        return set.length === 10 && set.every((v, i) => v === i)
      },
    ],
    [
      "terminals named",
      "Name the terminal states this document lists, one line.",
      (t) =>
        ["SUCCESS", "BLOCKED", "OUT_OF_SCOPE", "WAITING_APPROVAL"].filter((m) =>
          t.toUpperCase().replace(/_/g, "-").includes(m.replace(/_/g, "-")),
        ).length >= 3,
    ],
    [
      "G4 roles",
      "Which identity roles may execute gate G4? Name them.",
      (t) => /BUILD[_\s]?MODE/i.test(t) && /PLAN[_\s]?MODE/i.test(t),
    ],
  ]

  let passed = 0
  for (const [name, prompt, check] of checks) {
    const { text, tokens } = await ask(buffers, prompt)
    const ok = check(text)
    if (ok) passed++
    console.log(`[${ok ? "PASS" : "FAIL"}] ${name.padEnd(18)} tokens=${tokens}`)
    console.log(`       ${text.slice(0, 200).replace(/\n/g, " | ") || "(empty)"}`)
  }
  console.log("")
  console.log(`sharp renderer: ${passed}/${checks.length} checks passed`)

  // Reference: the Python/PIL render of the same configuration, for comparison.
  const pyFiles = ["C-p15-page1.webp", "C-p15-page2.webp", "C-p15-page3.webp"]
  const pyBufs = pyFiles.map((f) => readFileSync(join(import.meta.dir, "images-100fill", f)))
  console.log("")
  console.log("== reference: the PIL render of the same configuration ==")
  let pyPassed = 0
  for (const [name, prompt, check] of checks) {
    const { text, tokens } = await ask(pyBufs, prompt)
    const ok = check(text)
    if (ok) pyPassed++
    console.log(`[${ok ? "PASS" : "FAIL"}] ${name.padEnd(18)} tokens=${tokens}`)
    console.log(`       ${text.slice(0, 200).replace(/\n/g, " | ") || "(empty)"}`)
  }
  console.log("")
  console.log(`PIL reference: ${pyPassed}/${checks.length} checks passed`)
}

main()
