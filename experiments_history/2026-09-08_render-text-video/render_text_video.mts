// C5 probe renderer (2026-09-07): source code -> per-frame text -> PNG pages -> mp4.
// Usage: bun render_text_video.mts <srcFile> <outDir> <linesPerFrame> <fontSize> <secondsPerFrame> [width] [height]
// Frames hold static text pages; the provider encoder samples them (temporal
// redundancy = self-ensemble per the program plan, Stage 1).
import fs from "fs"
import path from "path"

const SRC = process.argv[2] ?? "packages/opencode/src/session/overflow.ts"
const OUT_DIR = process.argv[3] ?? "experiments/2026-09-08_render-text-video/comfortable"
const LINES_PER_FRAME = Number(process.argv[4] ?? 34)
const FONT_SIZE = Number(process.argv[5] ?? 22)
const SECONDS_PER_FRAME = Number(process.argv[6] ?? 2)
const WIDTH = Number(process.argv[7] ?? 1920)
const HEIGHT = Number(process.argv[8] ?? 1080)
const FONT = "C:/Windows/Fonts/consola.ttf"

const text = fs.readFileSync(SRC, "utf-8").replace(/\r\n/g, "\n")
const lines = text.split("\n")
const framesCount = Math.ceil(lines.length / LINES_PER_FRAME)
fs.mkdirSync(OUT_DIR, { recursive: true })

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, out, err }
}

const pad = (n: number) => String(n).padStart(3, "0")
const esc = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:")

for (let i = 0; i < framesCount; i++) {
  const chunk = lines.slice(i * LINES_PER_FRAME, (i + 1) * LINES_PER_FRAME).join("\n")
  const txtFile = path.join(OUT_DIR, `frame_${pad(i)}.txt`)
  fs.writeFileSync(txtFile, chunk)
  const png = path.join(OUT_DIR, `frame_${pad(i)}.png`)
  // drawtext quirks (2026-09-07, diagnosed live):
  //  - fontfile=<drive>\:... triggers "Both text and text file provided" in
  //    this ffmpeg build (parser bug on the escaped colon) — use the
  //    fontconfig default (Sans renders monospaced-looking here);
  //  - expansion=none mandatory: % in code ("Stray %").
  const txtPath = txtFile.replace(/\\/g, "/")
  const vf =
    `drawtext=textfile=${txtPath}` +
    `:fontcolor=0x1E1E1E:fontsize=${FONT_SIZE}:line_spacing=8:x=48:y=40` +
    `:expansion=none`
  const r = await run([
    "ffmpeg", "-y",
    "-f", "lavfi", "-i", `color=c=0xF7F7F7:s=${WIDTH}x${HEIGHT}`,
    "-vf", vf,
    "-frames:v", "1", png,
  ])
  if (r.code !== 0) {
    console.error(`frame ${i} failed:\n` + r.err.slice(-600))
    process.exit(1)
  }
}

const fps = 1 / SECONDS_PER_FRAME
const mp4 = path.join(OUT_DIR, "text_video.mp4")
const r2 = await run([
  "ffmpeg", "-y",
  "-framerate", String(fps),
  "-i", path.join(OUT_DIR, "frame_%03d.png"),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
  mp4,
])
if (r2.code !== 0) {
  console.error("concat failed:\n" + r2.err.slice(-600))
  process.exit(1)
}

const maxLine = lines.reduce((m, l) => Math.max(m, l.length), 0)
console.log(
  JSON.stringify({
    src: SRC,
    chars: text.length,
    lines: lines.length,
    maxLineLength: maxLine,
    frames: framesCount,
    linesPerFrame: LINES_PER_FRAME,
    fontSize: FONT_SIZE,
    seconds: framesCount * SECONDS_PER_FRAME,
    mp4,
    bytes: fs.statSync(mp4).size,
  }),
)
