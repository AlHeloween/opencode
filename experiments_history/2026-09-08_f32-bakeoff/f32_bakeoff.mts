// F3.2 (2026-09-08): lossy compression bake-off on code frames.
// For each code frame PNG: encode as JPEG q90 + FIASCO WFA (q-best),
// decode both back, measure bytes + PSNR, then wire-probe the vision model
// with the DECODED images (same ground-truth question) — OCR survival test.
// Never prints the API key.
import fs from "fs"
import path from "path"

const AUTH = new URL("../../bin/auth.json", import.meta.url)
const key = JSON.parse(fs.readFileSync(AUTH, "utf-8")).openrouter?.key
if (!key) {
  console.error("no openrouter key found")
  process.exit(1)
}

const FIASCO = path.resolve("experiments/2026-09-08_fiasco-target/release/fractal-encode.exe")
const DECODE = path.resolve("experiments/2026-09-08_fiasco-target/release/fractal-decode.exe")
const SRC_FRAME = process.argv[2] ?? "experiments/2026-09-08_render-text-video/sweep_85/frame_000.png"
const QUESTION = process.argv[3] ?? "the numeric value of the constant CHARS_PER_TOKEN"
const TRUTH = process.argv[4] ?? "4"

function run(cmd: string[]) {
  return new Promise<{ code: number; err: string }>((resolve) => {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" })
    Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]).then(
      ([, err, code]) => resolve({ code, err }),
    )
  })
}

// PSNR via ffmpeg signalstats (YUV)
async function psnr(a: string, b: string): Promise<number> {
  const proc = Bun.spawn(
    ["ffmpeg", "-hide_banner", "-i", a, "-i", b, "-filter_complex", "[0][1]psnr", "-f", "null", "-"],
    { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
  )
  const [, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  await proc.exited
  const m = err.match(/average:([\d.]+|inf)/)
  if (!m) return 0
  return m[1] === "inf" ? 999 : Number.parseFloat(m[1])
}

async function wireProbe(imagePath: string): Promise<{ answer: string; promptTokens?: number }> {
  const b64 = fs.readFileSync(imagePath).toString("base64")
  const mime = imagePath.endsWith(".png") ? "image/png" : "image/jpeg"
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "z-ai/glm-5.3-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
            { type: "text", text: `The image shows TypeScript source code. Reply with one short line: ${QUESTION} and nothing else.` },
          ],
        },
      ],
      max_tokens: 16384,
    }),
  })
  const payload = await response.json()
  if (payload.error) return { answer: `ERROR ${response.status}: ${JSON.stringify(payload.error).slice(0, 150)}` }
  return {
    answer: payload.choices?.[0]?.message?.content?.trim() ?? "(null)",
    promptTokens: payload.usage?.prompt_tokens,
  }
}

const kb = (p: string) => (fs.statSync(p).size / 1024).toFixed(1)
const outDir = path.dirname(SRC_FRAME)
const base = path.basename(SRC_FRAME, ".png")

// JPEG q90 reference
const jpg = path.join(outDir, `${base}_q90.jpg`)
await run(["ffmpeg", "-y", "-i", SRC_FRAME, "-q:v", "2", jpg])

// FIASCO quality ladder — pick the highest quality that still compresses
const wfaBest: { q: number; file: string } | null = null
let chosen: { q: number; file: string; psnr: number } | undefined
for (const q of [90, 70, 50, 30]) {
  const wfa = path.join(outDir, `${base}_q${q}.wfa`)
  const dec = path.join(outDir, `${base}_wfa_q${q}.png`)
  const enc = await run([FIASCO, "--input", SRC_FRAME, "--output", wfa, "--quality", String(q)])
  if (enc.code !== 0 || !fs.existsSync(wfa)) {
    console.log(`wfa q${q}: encode failed ${enc.err.slice(-200)}`)
    continue
  }
  const decRes = await run([DECODE, "--input", wfa, "--output", dec])
  if (decRes.code !== 0 || !fs.existsSync(dec)) {
    console.log(`wfa q${q}: decode failed ${decRes.err.slice(-200)}`)
    continue
  }
  const p = await psnr(SRC_FRAME, dec)
  console.log(`wfa q${q}: ${(kb(wfa))} KB (src ${kb(SRC_FRAME)} KB) PSNR ${p.toFixed(2)} dB`)
  if (!chosen || p > chosen.psnr) chosen = { q, file: wfa, decoded: dec, psnr: p } as any
}

const wfaDecoded = (chosen as any)?.decoded as string | undefined
const rows: Record<string, unknown>[] = []
rows.push({ codec: "PNG (source)", file: SRC_FRAME, kb: kb(SRC_FRAME), psnr: "inf" })
rows.push({ codec: "JPEG q~95", file: jpg, kb: kb(jpg), psnr: (await psnr(SRC_FRAME, jpg)).toFixed(2) })
if (wfaDecoded) rows.push({ codec: `FIASCO q${(chosen as any)!.q}`, file: chosen!.file, kb: kb(chosen!.file), psnr: chosen!.psnr.toFixed(2), decodedKb: kb(wfaDecoded) })

// OCR survival: wire probes on original vs decoded variants
console.log("\n--- OCR survival (same question per variant) ---")
const probeOrig = await wireProbe(SRC_FRAME)
console.log(`PNG source: "${probeOrig.answer}" (prompt ${probeOrig.promptTokens})`)
rows.push({ codec: "PNG (source)", wireAnswer: probeOrig.answer, correct: probeOrig.answer.includes(TRUTH) })
const probeJpg = await wireProbe(jpg)
console.log(`JPEG:       "${probeJpg.answer}" (prompt ${probeJpg.promptTokens})`)
rows.push({ codec: "JPEG", wireAnswer: probeJpg.answer, correct: probeJpg.answer.includes(TRUTH) })
if (wfaDecoded) {
  const probeWfa = await wireProbe(wfaDecoded)
  console.log(`FIASCO dec: "${probeWfa.answer}" (prompt ${probeWfa.promptTokens})`)
  rows.push({ codec: `FIASCO q${(chosen as any)!.q} decoded`, wireAnswer: probeWfa.answer, correct: probeWfa.answer.includes(TRUTH) })
}

fs.writeFileSync("experiments/2026-09-08_f32-bakeoff/f32_bakeoff_results.json", JSON.stringify(rows, null, 2))
console.table(rows)
