/**
 * Raw-byte divergence analysis between consecutive wire bodies.
 *
 * Pretty-diff aliases the wire truth (whitespace/key-order normalization),
 * so all offsets here are computed on the RAW body strings — the actual bytes
 * on the wire. The divergence offset D maps 1:1 to provider prefix-cache
 * coverage: everything before D was byte-identical to the previous request
 * (cacheable), everything from D onward is re-prefilled (cache lost).
 *
 * Offsets are UTF-16 code units (JS string indices); token estimates use the
 * same chars/3.5 convention as the kv-cache-parity tooling.
 */

export interface MessageSpan {
  /** Raw offset of the element's opening "{". */
  start: number
  /** Raw offset just past the element's closing "}". */
  end: number
  role: string
}

export interface RawDiffReport {
  verdict: "identical" | "pure-append" | "mutation" | "vanished"
  prevLength: number
  currLength: number
  prefixLength: number
  suffixLength: number
  insertedLength: number
  /** First divergence offset in currRaw (null when identical). */
  divergenceOffset: number | null
  /** messages[] element containing divergenceOffset (null: before array / no array). */
  messageIndex: number | null
  messageRole: string | null
  /** Offset of that message's opening "{" (null when messageIndex is null). */
  messageStart: number | null
  /** divergenceOffset - messageStart (null when messageIndex is null). */
  divergenceInMessageOffset: number | null
  /** Wire bytes covered by the provider prefix cache (≈ divergenceOffset). */
  cachedEstimate: number
  /** Wire bytes re-prefilled from divergenceOffset to end of currRaw. */
  uncachedEstimate: number
}

const CHARS_PER_TOKEN = 3.5

/**
 * Mask generation params that fluctuate per request but are proven cache-neutral
 * (max_tokens: live A/B showed 0.9998 hit at fluctuating values — generation
 * params are not part of prompt tokens). Same-position replacement with "0"
 * shortens the string; the shift is reported so RAW offsets stay exact.
 */
function maskScalars(raw: string): { masked: string; shift: number } {
  const masked = raw.replace(/("max_tokens"\s*:\s*)(-?\d+)/g, (_match, key: string) => `${key}0`)
  return { masked, shift: raw.length - masked.length }
}

/** Common prefix/suffix over raw strings — mirrors the kv-cache-parity analyzer. */
export function rawPrefixSuffix(prevRaw: string, currRaw: string) {
  const limit = Math.min(prevRaw.length, currRaw.length)
  let prefix = 0
  while (prefix < limit && prevRaw[prefix] === currRaw[prefix]) prefix++
  const suffixLimit = Math.min(prevRaw.length - prefix, currRaw.length - prefix)
  let suffix = 0
  while (
    suffix < suffixLimit &&
    prevRaw[prevRaw.length - 1 - suffix] === currRaw[currRaw.length - 1 - suffix]
  ) {
    suffix++
  }
  return { prefix, suffix, inserted: currRaw.length - prefix - suffix }
}

/**
 * Locate each `messages[]` element in the RAW body: brace-depth scan with
 * string-awareness, so braces inside JSON strings never desync the depth.
 */
export function messageSpans(raw: string): MessageSpan[] {
  const arrayMatch = /"messages"\s*:\s*\[/.exec(raw)
  if (!arrayMatch) return []
  const spans: MessageSpan[] = []
  const n = raw.length
  let i = (arrayMatch.index ?? 0) + arrayMatch[0].length
  while (i < n) {
    while (i < n && (raw[i] === " " || raw[i] === "," || raw[i] === "\n" || raw[i] === "\r" || raw[i] === "\t")) i++
    if (raw[i] !== "{") break
    const start = i
    let depth = 0
    let inStr = false
    let esc = false
    for (; i < n; i++) {
      const ch = raw[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === "\\") esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        if (depth === 0) {
          i++
          break
        }
      }
    }
    const role = /"role"\s*:\s*"([^"]*)"/.exec(raw.slice(start, i))?.[1] ?? "?"
    spans.push({ start, end: i, role })
  }
  return spans
}

function verdictOf(
  prevRaw: string,
  currRaw: string,
  prefix: number,
  suffix: number,
): RawDiffReport["verdict"] {
  if (prevRaw === currRaw) return "identical"
  const coveredPrev = prefix + suffix >= prevRaw.length
  const coveredCurr = prefix + suffix >= currRaw.length
  if (coveredPrev && coveredCurr) return "identical"
  if (coveredPrev) return currRaw.length > prevRaw.length ? "pure-append" : "vanished"
  if (coveredCurr) return "vanished"
  return "mutation"
}

export function analyzeRawDiff(prevRaw: string, currRaw: string): RawDiffReport {
  const prevMasked = maskScalars(prevRaw)
  const currMasked = maskScalars(currRaw)
  const { prefix, suffix, inserted } = rawPrefixSuffix(prevMasked.masked, currMasked.masked)
  const verdict = verdictOf(prevMasked.masked, currMasked.masked, prefix, suffix)
  const divergenceOffsetNormalized =
    verdict === "identical" ? null : Math.min(prefix, currMasked.masked.length)
  // Report offsets in RAW space: the mask only removes digits before messages[],
  // so everything after it shifts by a constant (currMasked.shift).
  const divergenceOffset =
    divergenceOffsetNormalized === null ? null : divergenceOffsetNormalized + currMasked.shift

  let messageIndex: number | null = null
  let messageRole: string | null = null
  let messageStart: number | null = null
  if (divergenceOffset !== null) {
    const spans = messageSpans(currMasked.masked)
    if (spans.length > 0) {
      // Divergence belongs to the span containing it; pure appends past the
      // last message attach to that last message.
      const found =
        spans.find((span) => divergenceOffsetNormalized! >= span.start && divergenceOffsetNormalized! < span.end) ??
        // Boundary case (pure appends): attach to the next message starting
        // at/after the divergence — but only when D is within/after messages[];
        // divergences before the array are envelope scalars, not messages.
        (divergenceOffsetNormalized! >= spans[0].start
          ? (spans.find((span) => span.start >= divergenceOffsetNormalized!) ??
            (divergenceOffsetNormalized! >= spans[spans.length - 1].end ? spans[spans.length - 1] : undefined))
          : undefined)
      if (found) {
        messageIndex = spans.indexOf(found)
        messageRole = found.role
        messageStart = found.start + currMasked.shift
      }
    }
  }

  return {
    verdict,
    prevLength: prevRaw.length,
    currLength: currRaw.length,
    prefixLength: prefix,
    suffixLength: suffix,
    insertedLength: inserted,
    divergenceOffset,
    messageIndex,
    messageRole,
    messageStart,
    divergenceInMessageOffset:
      messageStart !== null && divergenceOffset !== null ? divergenceOffset - messageStart : null,
    cachedEstimate: divergenceOffset ?? currRaw.length,
    uncachedEstimate: divergenceOffset !== null ? currRaw.length - divergenceOffset : 0,
  }
}

/** Pretty-print a raw JSON span; null when the slice is not valid JSON. */
function prettySpan(raw: string, span: MessageSpan, clamp: number): string | null {
  try {
    const pretty = JSON.stringify(JSON.parse(raw.slice(span.start, span.end)), null, 2)
    return clampText(pretty, clamp)
  } catch {
    return null
  }
}

function clampText(text: string, clamp: number): string {
  if (text.length <= clamp) return text
  const head = Math.floor(clamp * 0.75)
  const tail = clamp - head
  return `${text.slice(0, head)}\n… (clamped, total ${text.length} chars) …\n${text.slice(-tail)}`
}

/** Keep diff lines readable: giant embedded strings collapse to head+tail. */
function clampLines(text: string, maxLine = 240): string {
  return text
    .split("\n")
    .map((line) =>
      line.length <= maxLine ? line : `${line.slice(0, maxLine)} … (+${line.length - maxLine} chars)`,
    )
    .join("\n")
}

function escapeForDisplay(text: string): string {
  return text.replace(/\n/g, "\\n").replace(/\r/g, "\\r")
}

/** Envelope scalars (model/max_tokens/provider/…) — divergence before messages[]. */
function scalarsSection(prevRaw: string, currRaw: string): string | null {
  try {
    const pick = (value: Record<string, unknown>) =>
      Object.entries(value)
        .filter(([, v]) => typeof v !== "object" || v === null)
        .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
        .join("\n")
    const prev = JSON.parse(prevRaw) as Record<string, unknown>
    const curr = JSON.parse(currRaw) as Record<string, unknown>
    return `envelope scalars (divergence before messages[]):\n--- prev\n${clampLines(pick(prev))}\n--- curr\n${clampLines(pick(curr))}`
  } catch {
    return null
  }
}

export interface RenderInput {
  prevId: string
  prevRaw: string
  currId: string
  currRaw: string
}

/** Render the byte-true divergence report written next to raw-wire captures. */
export function renderRawDiff(input: RenderInput): string {
  const report = analyzeRawDiff(input.prevRaw, input.currRaw)
  const lines: string[] = [
    "RAW-WIRE DIVERGENCE REPORT (body_raw, byte-true; offsets = UTF-16 code units)",
    `prev: ${input.prevId} (${report.prevLength} chars)`,
    `curr: ${input.currId} (${report.currLength} chars)`,
    `verdict: ${report.verdict}`,
  ]
  if (report.divergenceOffset === null) {
    lines.push("bodies identical — cache fully covered")
    return lines.join("\n") + "\n"
  }
  const d = report.divergenceOffset
  lines.push(
    `common prefix: ${d} chars (${((d / Math.max(1, report.prevLength)) * 100).toFixed(1)}% of prev) ` +
      `| suffix: ${report.suffixLength} | inserted: ${report.insertedLength} @${d}`,
    `est uncached: ~${Math.round(report.uncachedEstimate / CHARS_PER_TOKEN)} tok ` +
      `(=${report.uncachedEstimate} chars from offset ${d} re-prefilled)`,
  )
  if (report.messageIndex !== null) {
    lines.push(
      `divergence inside message: #${report.messageIndex} (role=${report.messageRole}, ` +
        `raw offset ${report.messageStart}, divergence at +${report.divergenceInMessageOffset} inside)`,
    )
    lines.push(`cache estimate: covered = first ${report.messageIndex} messages; lost from offset ${d}`)
  } else {
    lines.push(`cache estimate: lost from offset ${d} (before/at envelope scalars or messages[])`)
  }

  const spans = messageSpans(input.currRaw)
  const k = report.messageIndex
  if (k !== null && spans[k]) {
    if (k > 0 && spans[k - 1]) {
      const before = prettySpan(input.currRaw, spans[k - 1], 8000)
      lines.push("", `@@ BEFORE — message #${k - 1} (${spans[k - 1].role}, prettified) @@`, before ?? "(unparseable span)")
    }
    const after = prettySpan(input.currRaw, spans[k], 8000)
    lines.push(
      "",
      `@@ AFTER — message #${k} (${spans[k].role}, prettified; divergence at +${report.divergenceInMessageOffset} inside) @@`,
      after ?? "(unparseable span)",
    )
  } else {
    const scalars = scalarsSection(input.prevRaw, input.currRaw)
    if (scalars) lines.push("", scalars)
  }

  lines.push(
    "",
    `@@ RAW context @${d} @@`,
    `prev: ${escapeForDisplay(input.prevRaw.slice(Math.max(0, d - 120), d))}`,
    `curr: ${escapeForDisplay(input.currRaw.slice(Math.max(0, d - 120), d + 240))}`,
  )
  return clampLines(lines.join("\n")) + "\n"
}

export interface ReasoningCollect {
  text: string
  provider?: string
  model?: string
  usage?: unknown
}

/**
 * Assemble reasoning text from a captured response body (readableResponseBody
 * shape: array of SSE chunk strings, or a raw SSE/non-stream string).
 * Collects delta.reasoning + reasoning_details[].text in stream order.
 */
export function collectReasoning(body: unknown): ReasoningCollect {
  const out = new ReasoningCollector()
  const chunks: unknown[] = Array.isArray(body) ? body : typeof body === "string" ? body.split("\n") : []
  for (const chunk of chunks) {
    let parsed: any = chunk
    if (typeof chunk === "string") {
      const payload = chunk.startsWith("data: ") ? chunk.slice(6) : chunk
      if (payload === "[DONE]") continue
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue
      }
    }
    if (parsed === null || typeof parsed !== "object") continue
    if (!out.provider && typeof parsed.provider === "string") out.provider = parsed.provider
    if (!out.model && typeof parsed.model === "string") out.model = parsed.model
    if (parsed.usage !== null && typeof parsed.usage === "object") out.usage = parsed.usage
    const choices = Array.isArray(parsed.choices) ? parsed.choices : []
    for (const choice of choices) {
      const delta = choice?.delta ?? choice?.message
      if (!delta || typeof delta !== "object") continue
      if (typeof delta.reasoning === "string") out.push(delta.reasoning)
      const details = Array.isArray(delta.reasoning_details) ? delta.reasoning_details : []
      for (const detail of details) {
        if (detail && typeof detail.text === "string") out.push(detail.text)
      }
    }
  }
  return { text: out.text, provider: out.provider, model: out.model, usage: out.usage }
}

class ReasoningCollector {
  parts: string[] = []
  last = ""
  provider: string | undefined
  model: string | undefined
  usage: unknown

  push(piece: string) {
    // SSE reasoning deltas often repeat the accumulating text (text = full
    // prefix); keep only the true suffix growth.
    if (piece.startsWith(this.last)) {
      this.parts.push(piece.slice(this.last.length))
      this.last = piece
      return
    }
    this.parts.push(piece)
    this.last = piece
  }

  get text(): string {
    return this.parts.join("")
  }
}

/** Render the per-response reasoning sidecar markdown. */
export function renderReasoningMarkdown(input: {
  id: string
  captured: string
  status?: number
  collect: ReasoningCollect
}): string {
  const lines = [
    "# Gateway response — assembled reasoning",
    "",
    `- id: ${input.id}`,
    `- captured: ${input.captured}`,
  ]
  if (input.status !== undefined) lines.push(`- status: ${input.status}`)
  if (input.collect.provider) lines.push(`- provider: ${input.collect.provider}`)
  if (input.collect.model) lines.push(`- model: ${input.collect.model}`)
  const usage = input.collect.usage as
    | { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens?: number }
    | undefined
  if (usage) {
    lines.push(
      `- usage: ${usage.prompt_tokens ?? "?"} prompt / ${usage.prompt_tokens_details?.cached_tokens ?? "?"} cached / ${usage.completion_tokens ?? "?"} completion`,
    )
  }
  lines.push("", "## Reasoning", "")
  lines.push(input.collect.text.trim() || "(no reasoning in this response)")
  lines.push("")
  return lines.join("\n")
}
