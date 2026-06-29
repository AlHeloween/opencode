/**
 * Port of diff.c LCS DP algorithm to pure JS using StringZilla sz.equal.
 * Exact 1:1 translation of the C logic, then benchmark vs C WASM.
 *
 * Run: bun run experiments/20260629_stringzilla_diff_bench.ts
 */
import { parseDiffFromFile } from "@pierre/diffs"
import sz from "../../wasm/core/node_modules/stringzilla/javascript/stringzilla.js"

// ── 1:1 port of diff.c helpers ────────────────────────────────────────────

const MAX_LINES = 4096 // bumped from 1024 for safety
const MAX_OUT = 65536

interface Line { off: number; len: number }

/**
 * C: static int split(Line *lines, int max, const unsigned char *text, int len)
 *
 * Split text into lines. Handles \n and \r\n.
 * Modifies text in-place to coalesce \r\n → \n (C version uses mem, we don't mutate input).
 */
function split(lines: Line[], max: number, text: string): number {
  let n = 0
  let off = 0
  for (let i = 0; i < text.length && n < max; i++) {
    if (text[i] === "\n") {
      // Strip trailing \r if present
      let len = i - off
      if (len > 0 && text[i - 1] === "\r") len--
      lines[n++] = { off, len }
      off = i + 1
    }
  }
  // Last line (may be empty if text ends with \n)
  if (off <= text.length && n < max) {
    lines[n++] = { off, len: text.length - off }
  }
  return n
}

/**
 * C: #define eq(a, alen, b, blen) ((alen) == (blen) && sz_equal((a), (b), (alen)))
 *
 * StringZilla Buffer equality for two line slices.
 */
function eq(aBuf: Buffer, aOff: number, aLen: number, bBuf: Buffer, bOff: number, bLen: number): boolean {
  if (aLen !== bLen) return false
  if (aLen === 0) return true
  const a = aBuf.subarray(aOff, aOff + aLen)
  const b = bBuf.subarray(bOff, bOff + bLen)
  return sz.equal(a, b)
}

// Direction constants (matching C dp_dir values)
const DIAG = 1 // match: dp_dir[i*dw+j] = 1 → diagonal
const UP   = 2 // deletion from old
const LEFT = 3 // insertion to new

interface DiffHunk {
  type: "equal" | "delete" | "insert"
  oldStart?: number
  newStart?: number
  oldEnd?: number
  newEnd?: number
  length?: number
}

/**
 * C: emit() — backtrack dp_dir table, produce JSON hunks.
 *
 * dp_dir values: 1=diag(match), 2=up(del), 3=left(ins)
 * Walk from (N, M) back to (0, 0).
 */
function emit(N: number, M: number, dpDir: Uint8Array, dw: number): DiffHunk[] {
  // Backtrack to collect path
  const path: number[] = [] // reversed: each entry is dp_dir value
  let i = N, j = M
  while (i > 0 || j > 0) {
    const d = dpDir[i * dw + j]
    path.push(d)
    if (d === DIAG) { i--; j-- }
    else if (d === UP) { i-- }
    else { j-- } // LEFT
  }
  path.reverse()

  // Convert path to hunks
  const hunks: DiffHunk[] = []
  let oi = 0, ni = 0 // old/new line indices
  let pi = 0

  while (pi < path.length) {
    const d = path[pi]

    if (d === DIAG) {
      // Count consecutive equal lines
      let run = 0
      while (pi < path.length && path[pi] === DIAG) { run++; pi++; oi++; ni++ }
      hunks.push({ type: "equal", oldStart: oi - run, newStart: ni - run, length: run })
    } else if (d === UP) {
      // Deletion
      const oldStart = oi
      while (pi < path.length && path[pi] === UP) { pi++; oi++ }
      hunks.push({ type: "delete", oldStart, oldEnd: oi })
    } else {
      // Insertion
      const newStart = ni
      while (pi < path.length && path[pi] === LEFT) { pi++; ni++ }
      hunks.push({ type: "insert", newStart, newEnd: ni })
    }
  }

  return hunks
}

/**
 * C: diff_compute() — 1:1 JS port of LCS DP using StringZilla sz.equal.
 */
function diffComputeSz(oldText: string, newText: string): DiffHunk[] {
  if (!oldText && !newText) return []

  const oldLines: Line[] = new Array(MAX_LINES)
  const newLines: Line[] = new Array(MAX_LINES)

  const N = split(oldLines, MAX_LINES, oldText)
  const M = split(newLines, MAX_LINES, newText)

  if (N === 0 && M === 0) return []

  // Encode full text to Buffer once for sz.equal subarray access
  const oldBuf = Buffer.from(oldText)
  const newBuf = Buffer.from(newText)

  const dw = M + 1
  const dpSize = (N + 1) * dw

  // dp_dir: Uint8Array (like unsigned char in C)
  const dpDir = new Uint8Array(dpSize)

  // Row buffers (unsigned short → Uint16Array)
  let prv = new Uint16Array(dw)
  let cur = new Uint16Array(dw)

  // Init: column 0 all UP, row 0 all LEFT
  for (let j = 0; j <= M; j++) { prv[j] = 0; dpDir[0 * dw + j] = LEFT }
  for (let i = 0; i <= N; i++) { dpDir[i * dw + 0] = UP }

  // LCS DP
  for (let i = 1; i <= N; i++) {
    cur[0] = 0
    // dp_dir already set above for j=0

    const aOff = oldLines[i - 1].off
    const aLen = oldLines[i - 1].len

    for (let j = 1; j <= M; j++) {
      const bOff = newLines[j - 1].off
      const bLen = newLines[j - 1].len

      if (eq(oldBuf, aOff, aLen, newBuf, bOff, bLen)) {
        cur[j] = prv[j - 1] + 1
        dpDir[i * dw + j] = DIAG
      } else if (prv[j] >= cur[j - 1]) {
        cur[j] = prv[j]
        dpDir[i * dw + j] = UP
      } else {
        cur[j] = cur[j - 1]
        dpDir[i * dw + j] = LEFT
      }
    }

    // Swap row pointers
    ;[prv, cur] = [cur, prv]
  }

  return emit(N, M, dpDir, dw)
}

// ── Pure-JS version (no StringZilla) for baseline ────────────────────────

function eqJs(a: string, aOff: number, aLen: number, b: string, bOff: number, bLen: number): boolean {
  if (aLen !== bLen) return false
  for (let k = 0; k < aLen; k++) {
    if (a[aOff + k] !== b[bOff + k]) return false
  }
  return true
}

function diffComputeJs(oldText: string, newText: string): DiffHunk[] {
  if (!oldText && !newText) return []

  const oldLines: Line[] = new Array(MAX_LINES)
  const newLines: Line[] = new Array(MAX_LINES)

  const N = split(oldLines, MAX_LINES, oldText)
  const M = split(newLines, MAX_LINES, newText)

  if (N === 0 && M === 0) return []

  const dw = M + 1
  const dpSize = (N + 1) * dw
  const dpDir = new Uint8Array(dpSize)

  let prv = new Uint16Array(dw)
  let cur = new Uint16Array(dw)

  for (let j = 0; j <= M; j++) { prv[j] = 0; dpDir[0 * dw + j] = LEFT }
  for (let i = 0; i <= N; i++) { dpDir[i * dw + 0] = UP }

  for (let i = 1; i <= N; i++) {
    cur[0] = 0
    const aOff = oldLines[i - 1].off
    const aLen = oldLines[i - 1].len

    for (let j = 1; j <= M; j++) {
      const bOff = newLines[j - 1].off
      const bLen = newLines[j - 1].len

      if (eqJs(oldText, aOff, aLen, newText, bOff, bLen)) {
        cur[j] = prv[j - 1] + 1
        dpDir[i * dw + j] = DIAG
      } else if (prv[j] >= cur[j - 1]) {
        cur[j] = prv[j]
        dpDir[i * dw + j] = UP
      } else {
        cur[j] = cur[j - 1]
        dpDir[i * dw + j] = LEFT
      }
    }

    ;[prv, cur] = [cur, prv]
  }

  return emit(N, M, dpDir, dw)
}

// ── WASM diff loader ─────────────────────────────────────────────────────

let _wasmReady = false
let _diffComputeWasm: ((op: number, ol: number, np: number, nl: number, outp: number, outc: number) => number) | null = null
let _wasmMemory: WebAssembly.Memory | null = null

const _wasmInit = (async () => {
  try {
    const url = new URL("../../../wasm/core/pkg/diff.wasm", import.meta.url)
    const resp = await fetch(url)
    if (!resp.ok) return
    const bytes = await resp.arrayBuffer()
    const mod = await WebAssembly.compile(bytes)
    const mem = new WebAssembly.Memory({ initial: 256, maximum: 512 })
    const env_strlen = (ptr: number): number => {
      const u8 = new Uint8Array(mem.buffer)
      let len = 0; while (u8[ptr + len] !== 0) len++
      return len
    }
    const instance = await WebAssembly.instantiate(mod, { env: { memory: mem, strlen: env_strlen } })
    const spGlobal = instance.exports.__stack_pointer as WebAssembly.Global
    spGlobal.value = 16 * 1024 * 1024
    _diffComputeWasm = instance.exports.diff_compute as any
    _wasmMemory = mem
    _wasmReady = true
  } catch (e) {
    console.error("WASM init failed:", e)
  }
})()

function diffLinesWasm(before: string, after: string): DiffHunk[] {
  if (!_wasmReady || !_diffComputeWasm || !_wasmMemory) return []

  const oldBytes = new TextEncoder().encode(before)
  const newBytes = new TextEncoder().encode(after)
  const mem = new Uint8Array(_wasmMemory.buffer)

  const oldPtr = 0
  const newPtr = oldBytes.length + 64
  const outPtr = newPtr + newBytes.length + 64
  const outCap = _wasmMemory.buffer.byteLength - outPtr - 4

  if (outPtr + newBytes.length >= _wasmMemory.buffer.byteLength) return []

  mem.set(oldBytes, oldPtr)
  mem.set(newBytes, newPtr)

  const outLen = _diffComputeWasm(oldPtr, oldBytes.length, newPtr, newBytes.length, outPtr, outCap)
  if (outLen <= 0) return []

  const outBytes = mem.slice(outPtr, outPtr + outLen)
  const json = new TextDecoder().decode(outBytes)
  try {
    return JSON.parse(json) as DiffHunk[]
  } catch {
    return []
  }
}

// ── Test cases ────────────────────────────────────────────────────────────

function generateLines(count: number, base: string): string {
  const lines: string[] = []
  for (let i = 0; i < count; i++) {
    lines.push(`${base} line ${i} with some padding to make it realistic length for diffing`)
  }
  return lines.join("\n")
}

function modifyLines(text: string, pct: number): string {
  const lines = text.split("\n")
  const result = [...lines]
  const modCount = Math.floor(lines.length * pct)
  for (let i = 0; i < modCount; i++) {
    const idx = Math.floor(Math.random() * lines.length)
    result[idx] = `MODIFIED line ${idx} at ${Date.now()} with some extra padding for realism`
  }
  return result.join("\n")
}

// ── Correctness first ─────────────────────────────────────────────────────

console.log("StringZilla capabilities:", sz.capabilities)

// Wait for WASM to load
await new Promise(r => setTimeout(r, 1000))
console.log("WASM ready:", _wasmReady)

const smokeTests: [string, string, string][] = [
  ["identical", "a\nb\nc", "a\nb\nc"],
  ["insert", "a\nb", "a\nx\nb"],
  ["delete", "a\nb\nc", "a\nc"],
  ["modify", "line1\nold\nline3", "line1\nnew\nline3"],
  ["empty_both", "", ""],
  ["empty_old", "", "new\nlines"],
  ["empty_new", "old\nlines", ""],
  ["one_line", "hello", "world"],
  ["crlf", "a\r\nb\r\n", "a\r\nb\r\n"],
  ["trailing_newline", "a\nb\nc\n", "a\nx\nc\n"],
]

console.log("\n--- Correctness ---")

function hunksMatch(a: DiffHunk[], b: DiffHunk[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

let szMatch = 0, jsMatch = 0, total = 0
for (const [name, oldText, newText] of smokeTests) {
  total++
  const wasm = diffLinesWasm(oldText, newText)
  const szRes = diffComputeSz(oldText, newText)
  const jsRes = diffComputeJs(oldText, newText)

  const szOk = hunksMatch(wasm, szRes)
  const jsOk = hunksMatch(wasm, jsRes)
  if (szOk) szMatch++
  if (jsOk) jsMatch++

  const mark = (szOk && jsOk) ? "OK" : (!szOk && !jsOk) ? "BOTH FAIL" : (szOk ? "SZ" : "JS")
  console.log(`  ${name}: ${mark}`)
  if (!szOk || !jsOk) {
    console.log(`    WASM: ${JSON.stringify(wasm)}`)
    console.log(`    SZ:   ${JSON.stringify(szRes)}`)
    console.log(`    JS:   ${JSON.stringify(jsRes)}`)
  }
}
console.log(`  SZ: ${szMatch}/${total}  JS: ${jsMatch}/${total}`)

// ── Benchmark ─────────────────────────────────────────────────────────────

const perfCases: [string, string, string][] = [
  ["50 identical", generateLines(50, "m"), generateLines(50, "m")],
  ["50 20% mod", generateLines(50, "m"), modifyLines(generateLines(50, "m"), 0.2)],
  ["200 identical", generateLines(200, "l"), generateLines(200, "l")],
  ["200 20% mod", generateLines(200, "l"), modifyLines(generateLines(200, "l"), 0.2)],
  ["500 identical", generateLines(500, "xl"), generateLines(500, "xl")],
  ["500 10% mod", generateLines(500, "xl"), modifyLines(generateLines(500, "xl"), 0.1)],
]

const ITER = 10

console.log(`\n--- Benchmark (${ITER} iterations) ---`)
console.log("| Case | WASM (ms) | JS LCS (ms) | SZ LCS (ms) | SZ/JS | SZ/WASM |")
console.log("|------|-----------|-------------|-------------|-------|---------|")

for (const [name, oldText, newText] of perfCases) {
  // Warm up once
  diffLinesWasm(oldText, newText)
  diffComputeJs(oldText, newText)
  diffComputeSz(oldText, newText)

  // WASM
  const wasmTimes: number[] = []
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now()
    diffLinesWasm(oldText, newText)
    wasmTimes.push(performance.now() - t0)
  }

  // JS
  const jsTimes: number[] = []
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now()
    diffComputeJs(oldText, newText)
    jsTimes.push(performance.now() - t0)
  }

  // SZ
  const szTimes: number[] = []
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now()
    diffComputeSz(oldText, newText)
    szTimes.push(performance.now() - t0)
  }

  const wAvg = wasmTimes.reduce((a, b) => a + b) / ITER
  const jAvg = jsTimes.reduce((a, b) => a + b) / ITER
  const sAvg = szTimes.reduce((a, b) => a + b) / ITER

  console.log(
    `| ${name} | ${wAvg.toFixed(3)} | ${jAvg.toFixed(3)} | ${sAvg.toFixed(3)} | ${(jAvg/sAvg).toFixed(2)}x | ${(wAvg/sAvg).toFixed(2)}x |`
  )
}
