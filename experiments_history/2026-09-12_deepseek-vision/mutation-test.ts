// MUTATION BLIND TEST: separate READING from MEMORY.
//
// The previous blind test could not tell whether the model read the pixels or recalled the
// file from training. This one removes that ambiguity: the source is mechanically mutated
// before rendering, so the answers exist nowhere except in the pixels.
//
// Mutation (deterministic, reversible, applied to identifiers only):
//   every declared top-level name  ->  name + suffix from a fixed alphabet (Zx, Qv, ...)
//   every integer literal          ->  literal + a fixed offset
// Both transformations are recorded in `mutation-map.json`, and the ground truth is computed
// FROM THE MUTATED SOURCE. Therefore:
//
//   model reports mutated names/values  -> it READ the pixels
//   model reports original names/values -> it recalled training data
//
// Questions deliberately ask for things a memorising model would get wrong:
//   - the (mutated) names of top-level functions
//   - the (mutated) values of numeric constants
//
// Run: bun experiments/2026-09-12_deepseek-vision/mutation-test.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "mutation-test")
const TARGET = process.argv[2] ?? join(import.meta.dir, "..", "..", "packages/opencode/src/session/compaction.ts")
const URL = "https://api.deepseek.com/chat/completions"
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-flash"

const PAGE_W = 1280
const PAGE_H = 1260
const ADV = 8
const PITCH = 15
const COLS = PAGE_W / ADV
const CELLS = COLS * (PAGE_H / PITCH)
const FONT_SIZE = 14
const OFFSET = 137 // added to every integer literal

function loadKey(): string {
  const env = process.env.DEEPSEEK_API_KEY?.trim()
  if (env) return env
  const auth = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "bin", "auth.json"), "utf8"))
  if (auth?.deepseek?.key) return String(auth.deepseek.key)
  throw new Error("no deepseek key")
}
const KEY = loadKey()

// ---------------------------------------------------------------- mutation

const SUFFIXES = ["Zx", "Qv", "Kp", "Wn", "Rt", "Ym", "Hb", "Ls", "Df", "Gc", "Nv", "Pe"]

function mutate(src: string): { mutated: string; map: Record<string, string>; valueMap: Record<string, number> } {
  const map: Record<string, string> = {}
  const valueMap: Record<string, number> = {}

  // 1. collect declared top-level names (functions, consts, types)
  const declared = new Set<string>()
  for (const m of src.matchAll(/^(?:export\s+)?(?:function|const|type|interface|class)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
    declared.add(m[1]!)
  }
  // skip trivially short/common names to keep the mutation readable
  const names = [...declared].filter((n) => n.length >= 4)
  for (let i = 0; i < names.length; i++) map[names[i]!] = names[i]! + SUFFIXES[i % SUFFIXES.length]!

  // 2. apply renames as whole words
  let out = src
  for (const [from, to] of Object.entries(map).sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`\\b${from}\\b`, "g"), to)
  }

  // 3. bump integer literals in const declarations (values only, not line numbers in strings)
  out = out.replace(/(\bconst\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*)([0-9][0-9_]*)\b/g, (_m, head: string, digits: string) => {
    const value = Number(digits.replace(/_/g, ""))
    const bumped = value + OFFSET
    valueMap[head.trim().split(/\s+/)[1] ?? "?"] = bumped
    return head + String(bumped)
  })

  return { mutated: out, map, valueMap }
}

// ---------------------------------------------------------------- rendering

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

function pageSvg(chunk: string): string {
  const parts: string[] = []
  for (let i = 0; i < chunk.length && i < CELLS; i++) {
    const ch = chunk[i]!
    if (ch === " " || ch === "\n" || ch === "\t") continue
    parts.push(
      `<text x="${(i % COLS) * ADV}" y="${Math.floor(i / COLS) * PITCH + FONT_SIZE}">${escapeXml(ch)}</text>`,
    )
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}">`,
    `<rect width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>`,
    `<g fill="#000" font-family="Consolas" font-size="${FONT_SIZE}px" xml:space="preserve">`,
    parts.join(""),
    "</g></svg>",
  ].join("")
}

function toLines(src: string): string {
  const out: string[] = []
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\t/g, "    ")
    if (line.length <= COLS) out.push(line)
    else for (let i = 0; i < line.length; i += COLS) out.push(line.slice(i, i + COLS))
  }
  return out.join("\n")
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
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "user-agent": "opencode-mutation-test" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content }], max_tokens: maxTokens, thinking: { type: "disabled" } }),
  })
  if (!res.ok) return { text: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number } }
  return { text: json.choices?.[0]?.message?.content?.trim() ?? "", tokens: json.usage?.prompt_tokens }
}

// ---------------------------------------------------------------- main

async function main() {
  mkdirSync(DIR, { recursive: true })
  const original = readFileSync(TARGET, "utf8")
  const { mutated, map, valueMap } = mutate(original)

  // ground truth FROM THE MUTATED SOURCE
  const fnNames = [...mutated.matchAll(/^(?:export\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/gm)].map((m) => m[1]!)
  const constNames = [...mutated.matchAll(/^(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]!)
  const numericConsts = [...mutated.matchAll(/\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([0-9][0-9_]*)\b/g)].map((m) => ({
    name: m[1]!,
    value: Number(m[2]!.replace(/_/g, "")),
  }))

  const truth = {
    original: { functions: [...original.matchAll(/^(?:export\s+)?function\s+(\w+)/gm)].map((m) => m[1]!) },
    mutated: { functions: fnNames, consts: constNames, numericConsts },
    renames: map,
    valueShifts: { offset: OFFSET, values: valueMap },
  }
  writeFileSync(join(DIR, "mutation-map.json"), JSON.stringify(truth, null, 2))
  writeFileSync(join(DIR, "mutated-source.ts"), mutated)

  console.log(`target : ${TARGET}`)
  console.log(`renamed: ${Object.keys(map).length} identifiers (+suffix)`)
  console.log(`values : every integer const shifted by +${OFFSET}`)
  console.log(`mutated: ${mutated.length} chars -> needs ${Math.ceil(mutated.length / CELLS)} pages`)
  console.log("")
  console.log("sample renames       :", Object.entries(map).slice(0, 4).map(([a, b]) => `${a} -> ${b}`).join(", "))
  console.log("sample shifted values:", numericConsts.slice(0, 4).map((c) => `${c.name}=${c.value}`).join(", "))
  console.log("")

  const pages = await render(toLines(mutated))
  for (let i = 0; i < pages.length; i++) writeFileSync(join(DIR, `page${i + 1}.webp`), pages[i]!)
  console.log(`rendered ${pages.length} pages, ${pages.reduce((a, b) => a + b.length, 0)} bytes`)
  console.log("")

  const questions: [string, string][] = [
    [
      "function names",
      "This image set shows a TypeScript file rendered as pixels. List EVERY top-level function name " +
        "exactly as it appears in the image, one per line, nothing else. Do not guess - only report names " +
        "you can actually see.",
    ],
    [
      "numeric constants",
      "List every numeric `const` you can see in this image with its exact value, in the form NAME=VALUE, " +
        "one per line. Report only values you can actually read.",
    ],
  ]

  const report: string[] = []
  for (const [name, prompt] of questions) {
    const { text, tokens } = await ask(pages, prompt)
    console.log(`--- ${name} (tokens=${tokens}) ---`)
    console.log(text)
    console.log("")
    report.push(`## ${name} (tokens=${tokens})\n\n${text}\n`)
  }
  writeFileSync(join(DIR, "answers.md"), report.join("\n"))
  console.log(`answers -> ${join(DIR, "answers.md")}`)
}

main()
