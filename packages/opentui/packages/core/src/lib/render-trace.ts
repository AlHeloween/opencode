/**
 * Render trace — the OBSERVATION SEAM for text blocks (T13a of plans/2026-09-22_reasoning-stream-render-stability.md).
 *
 * Owner, 2026-09-24: «у opentui есть своё кэширование, почему я говорил про буфер — потому что на него всегда
 * можно повесить дебаг и спокойно отлавливать флики», and «каждый раз если что-то меняется оно сбрасывается,
 * мы просто палим проц, это не только флики». Every write into a CodeRenderable's buffer and every frame that
 * DRAWS it report here, so a flicker the owner sees live can be named, and so can the waste.
 *
 * Three kinds of record, all JSONL:
 *   paint  — a write into the buffer: its SOURCE, the text/style signatures, and inline flags
 *            (`redundant` = identical to the previous write: no change, every OpenTUI cache reset;
 *            `restyle` / `return` / `text-return` — per WRITE, so an upper bound: writes between two frames
 *            coalesce and only the last is ever seen);
 *   drawn  — the state a frame actually DREW for a block, emitted only when it differs from the block's previous
 *            drawn state: blank or not, y, height, and — when the style changed — one [textHash, styleHash] per
 *            logical line. Lines, not blocks: a streaming block changes its text on every delta, so «same text,
 *            other style» exists only per line (the class T11 fixed was exactly that);
 *   frame  — the serials drawn in that frame, so a reader can tell «unchanged» from «not drawn» (culled).
 * `serial` is unique per renderable INSTANCE; `id` is the renderable id and is reused when Markdown recreates a
 * block at the same index — key by serial (or by line text), never by id.
 *
 * Off (no `OTUI_RENDER_TRACE` path and no sink) every hook costs one boolean check. On, records are buffered
 * and appended every 250 ms — never a synchronous write per paint on the render thread.
 */
import { appendFileSync } from "node:fs"
import type { StyledText } from "./styled-text.js"

export type PaintSource =
  | "construct"
  | "setter"
  | "preview"
  | "stored-parse"
  | "ensure-visible"
  | "parse"
  | "parse-failed"
  | "no-filetype"

export type PaintEvent = {
  kind: "paint"
  t: number
  frame: number
  serial: number
  id: string
  source: PaintSource
  event: "paint" | "restyle" | "return" | "text-return" | "redundant"
  chars: number
  sig: string
  textSig: string
  previousSource?: PaintSource
}

export type DrawnEvent = {
  kind: "drawn"
  t: number
  frame: number
  serial: number
  id: string
  blank: boolean
  y: number
  height: number
  sig: string
  textSig: string
  /** Per logical line [textHash, styleHash, length]; present only when `sig` changed since the last drawn record. */
  lines?: Array<[string, string, number]>
}

export type FrameEvent = { kind: "frame"; frame: number; drawn: number[] }

export type RenderTraceEvent = PaintEvent | DrawnEvent | FrameEvent

type Block = {
  serial: number
  lastText: string
  lastSig: string
  lastSource: PaintSource
  lastStyled: StyledText | string
  recent: Array<{ text: string; sig: string }>
  drawnKey?: string
  drawnSig?: string
}

const HISTORY = 8
const FLUSH_MS = 250

const tracePath = process.env.OTUI_RENDER_TRACE || undefined
let sink: ((event: RenderTraceEvent) => void) | null = null
let enabled = tracePath !== undefined
const blocks = new WeakMap<object, Block>()
let nextSerial = 1
let pending: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let currentFrame: number | undefined
let drawnThisFrame: number[] = []

/** Tests install an in-memory sink; `null` removes it. The env path, if set, keeps working alongside. */
export function setRenderTraceSink(next: ((event: RenderTraceEvent) => void) | null): void {
  sink = next
  enabled = tracePath !== undefined || sink !== null
}

export function isRenderTraceEnabled(): boolean {
  return enabled
}

function flush(): void {
  flushTimer = null
  if (!tracePath || pending.length === 0) return
  const lines = pending.join("")
  pending = []
  try {
    appendFileSync(tracePath, lines)
  } catch (error) {
    console.warn("bug: render trace write failed:", error)
  }
}

function emit(event: RenderTraceEvent): void {
  sink?.(event)
  if (!tracePath) return
  pending.push(JSON.stringify(event) + "\n")
  if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_MS)
    ;(flushTimer as { unref?: () => void }).unref?.()
  }
}

/** FNV-1a — a signature, not a checksum; a collision can only hide an event, never invent one. */
function fnv(value: string, seed = 0x811c9dc5): number {
  let hash = seed
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

type Piece = { text: string; style: string }

function pieces(text: StyledText | string): Piece[] {
  if (typeof text === "string") return [{ text, style: "-" }]
  return text.chunks.map((chunk) => ({
    text: chunk.text,
    style: `${chunk.fg ? `${chunk.fg.r},${chunk.fg.g},${chunk.fg.b}` : "-"}|${chunk.bg ? `${chunk.bg.r},${chunk.bg.g},${chunk.bg.b}` : "-"}|${chunk.attributes ?? 0}`,
  }))
}

function signature(text: StyledText | string): { plain: string; sig: string } {
  let hash = 0x811c9dc5
  let plain = ""
  for (const piece of pieces(text)) {
    plain += piece.text
    hash = fnv(piece.text, hash)
    hash = fnv(`|${piece.style}|`, hash)
  }
  return { plain, sig: hash.toString(16) }
}

/** One [textHash, styleHash] per logical line (split at "\n"), style hashed over the runs inside that line. */
function lineSignatures(text: StyledText | string): Array<[string, string, number]> {
  const out: Array<[string, string, number]> = []
  let lineText = ""
  let lineStyle = 0x811c9dc5
  const close = () => {
    out.push([fnv(lineText).toString(16), fnv(lineText, lineStyle).toString(16), lineText.length])
    lineText = ""
    lineStyle = 0x811c9dc5
  }
  for (const piece of pieces(text)) {
    const parts = piece.text.split("\n")
    parts.forEach((part, index) => {
      if (index > 0) close()
      if (part.length === 0) return
      lineText += part
      lineStyle = fnv(`${part.length}|${piece.style}|`, lineStyle)
    })
  }
  close()
  return out
}

function blockOf(owner: object, text: StyledText | string, source: PaintSource): { block: Block; fresh: boolean } {
  const existing = blocks.get(owner)
  if (existing) return { block: existing, fresh: false }
  const { plain, sig } = signature(text)
  const block: Block = {
    serial: nextSerial++,
    lastText: plain,
    lastSig: sig,
    lastSource: source,
    lastStyled: text,
    recent: [{ text: plain, sig }],
  }
  blocks.set(owner, block)
  return { block, fresh: true }
}

/** One write into `owner`'s buffer from `source`. Call only when `isRenderTraceEnabled()`. */
export function recordPaint(owner: object, id: string, frame: number, source: PaintSource, text: StyledText | string): void {
  const { plain, sig } = signature(text)
  const { block, fresh } = blockOf(owner, text, source)
  const base = {
    kind: "paint" as const,
    t: Math.round(performance.now()),
    frame,
    serial: block.serial,
    id,
    source,
    chars: plain.length,
    sig,
    textSig: fnv(plain).toString(16),
  }
  if (fresh) {
    emit({ ...base, event: "paint" })
    return
  }
  const previousSource = block.lastSource
  const sameText = plain === block.lastText
  if (sameText && sig === block.lastSig) emit({ ...base, event: "redundant", previousSource })
  else if (sameText) {
    const back = block.recent.some((entry) => entry.text === plain && entry.sig === sig)
    emit({ ...base, event: back ? "return" : "restyle", previousSource })
  } else if (block.recent.some((entry) => entry.text === plain)) emit({ ...base, event: "text-return", previousSource })
  else emit({ ...base, event: "paint" })
  block.lastText = plain
  block.lastSig = sig
  block.lastSource = source
  block.lastStyled = text
  block.recent.push({ text: plain, sig })
  if (block.recent.length > HISTORY) block.recent.shift()
}

/** `owner` was rendered in `frame`; `blank` = it drew no text this frame. Call only when enabled. */
export function recordDrawn(owner: object, id: string, frame: number, blank: boolean, y: number, height: number): void {
  const block = blocks.get(owner)
  // A block drawn before any paint has nothing to show; it is drawn blank by definition.
  const sig = block?.lastSig ?? "-"
  const text = block?.lastText ?? ""
  if (currentFrame !== frame) {
    if (currentFrame !== undefined) emit({ kind: "frame", frame: currentFrame, drawn: drawnThisFrame })
    currentFrame = frame
    drawnThisFrame = []
  }
  const serial = block?.serial ?? 0
  drawnThisFrame.push(serial)
  const key = `${blank ? 1 : 0}|${sig}|${y}|${height}`
  if (block && block.drawnKey === key) return
  const styleChanged = !block || block.drawnSig !== sig
  if (block) {
    block.drawnKey = key
    block.drawnSig = sig
  }
  emit({
    kind: "drawn",
    t: Math.round(performance.now()),
    frame,
    serial,
    id,
    blank,
    y,
    height,
    sig,
    textSig: fnv(text).toString(16),
    lines: styleChanged && block ? lineSignatures(block.lastStyled) : undefined,
  })
}

/** A frame record is emitted when the NEXT frame draws; this closes the current one (end of a trace, tests). */
export function closeRenderTraceFrame(): void {
  if (currentFrame === undefined) return
  emit({ kind: "frame", frame: currentFrame, drawn: drawnThisFrame })
  currentFrame = undefined
  drawnThisFrame = []
}

/** Lines shorter than this are too ambiguous to track across frames (blank lines, "- ", "}"). */
const MIN_TRACKED_LINE = 8

export type RenderTraceReport = {
  paints: number
  redundant: number
  redundantByTransition: Record<string, number>
  frames: number
  /** A drawn line went back to a style it had, with another style drawn in between — the colour flicker. */
  lineReturns: number
  /** A block drawn with text, then blank, then with text again — the blank flash. */
  blankFlashes: number
  /** The same block text drawn at another height (conceal changed the line count) — a layout jump. */
  reflows: number
  findings: string[]
}

/**
 * What the eye saw, decided over the DRAWN states frame by frame (not over writes). Pure: the reader script
 * and the tests call the same function, so the oracle has one implementation.
 */
export function analyzeRenderTrace(events: RenderTraceEvent[]): RenderTraceReport {
  const paints = events.filter((event): event is PaintEvent => event.kind === "paint")
  const redundant = paints.filter((event) => event.event === "redundant")
  const redundantByTransition: Record<string, number> = {}
  for (const event of redundant) {
    const key = `${event.previousSource}->${event.source}`
    redundantByTransition[key] = (redundantByTransition[key] ?? 0) + 1
  }

  type State = { blank: boolean; height: number; textSig: string; lines: Array<[string, string, number]> }
  const state = new Map<number, State>()
  const lineHistory = new Map<string, string[]>()
  const blankHistory = new Map<number, boolean[]>()
  const findings: string[] = []
  let lineReturns = 0
  let reflows = 0
  let frames = 0

  for (const event of events) {
    if (event.kind === "drawn") {
      const previous = state.get(event.serial)
      if (previous && !event.blank && !previous.blank && previous.textSig === event.textSig && previous.height !== event.height) {
        reflows++
        if (findings.length < 20) findings.push(`REFLOW      serial ${event.serial} (${event.id}) frame ${event.frame}: height ${previous.height} -> ${event.height}, same text`)
      }
      state.set(event.serial, {
        blank: event.blank,
        height: event.height,
        textSig: event.textSig,
        lines: event.lines ?? previous?.lines ?? [],
      })
      continue
    }
    if (event.kind !== "frame") continue
    frames++
    // The frame's visible lines: text -> the set of styles it is drawn with in THIS frame.
    const visible = new Map<string, Set<string>>()
    for (const serial of event.drawn) {
      const drawn = state.get(serial)
      if (!drawn) continue
      const blanks = blankHistory.get(serial) ?? []
      if (blanks[blanks.length - 1] !== drawn.blank) blanks.push(drawn.blank)
      blankHistory.set(serial, blanks)
      if (drawn.blank) continue
      for (const [textHash, styleHash, length] of drawn.lines) {
        if (length < MIN_TRACKED_LINE) continue
        const styles = visible.get(textHash) ?? new Set<string>()
        styles.add(styleHash)
        visible.set(textHash, styles)
      }
    }
    for (const [textHash, styles] of visible) {
      // The same text drawn in two places with two styles in one frame is ambiguous, not a flicker.
      if (styles.size !== 1) continue
      const style = [...styles][0]!
      const history = lineHistory.get(textHash) ?? []
      if (history[history.length - 1] !== style) {
        if (history.includes(style)) {
          lineReturns++
          if (findings.length < 20) findings.push(`LINE-RETURN line ${textHash} frame ${event.frame}: style ${style} again after ${history[history.length - 1]}`)
        }
        history.push(style)
        if (history.length > HISTORY) history.shift()
      }
      lineHistory.set(textHash, history)
    }
  }

  let blankFlashes = 0
  for (const [serial, blanks] of blankHistory) {
    for (let i = 1; i < blanks.length - 1; i++) {
      if (blanks[i] && !blanks[i - 1] && !blanks[i + 1]) {
        blankFlashes++
        if (findings.length < 20) findings.push(`BLANK-FLASH serial ${serial}`)
      }
    }
  }

  return {
    paints: paints.length,
    redundant: redundant.length,
    redundantByTransition,
    frames,
    lineReturns,
    blankFlashes,
    reflows,
    findings,
  }
}
