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

export interface AssembledMessage {
  content: string
  reasoning: string
  toolCalls: Array<{ id: string; name: string; arguments: string }>
  finishReason: string | null
  usage: unknown
}

/**
 * Assemble the FULL assistant message from a captured response body
 * (readableResponseBody shape: array of SSE chunk strings, a raw SSE string,
 * or a parsed non-stream completion object). Mirrors SDK accumulation:
 * content join, reasoning suffix-growth dedup (absorbs the OpenRouter dual
 * dialect copy), tool_calls fragments joined per index.
 */
export function assembleMessage(body: unknown): AssembledMessage {
  const out: AssembledMessage = { content: "", reasoning: "", toolCalls: [], finishReason: null, usage: null }
  const collector = new ReasoningCollector()
  const calls = new Map<number, { id: string; name: string; arguments: string }>()
  let finishReason: string | null = null
  let usage: unknown = null
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    // Non-stream completion object: the message is already whole.
    const parsed = body as Record<string, unknown>
    const choices = Array.isArray(parsed.choices) ? (parsed.choices as Array<Record<string, unknown>>) : []
    const choice = choices[0]
    const message = (choice?.message ?? {}) as Record<string, unknown>
    out.content = typeof message.content === "string" ? message.content : ""
    out.reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : ""
    out.finishReason = (choice?.finish_reason as string | null) ?? null
    out.usage = parsed.usage ?? null
    for (const call of (Array.isArray(message.tool_calls) ? message.tool_calls : []) as Array<
      Record<string, unknown>
    >) {
      const fn = (call.function ?? {}) as Record<string, unknown>
      out.toolCalls.push({
        id: String(call.id ?? ""),
        name: String(fn.name ?? ""),
        arguments: String(fn.arguments ?? ""),
      })
    }
    return out
  }
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
    if (parsed.usage !== null && typeof parsed.usage === "object" && parsed.usage.total_tokens) {
      usage = parsed.usage
    }
    const choices = Array.isArray(parsed.choices) ? parsed.choices : []
    for (const choice of choices) {
      if (choice?.finish_reason) finishReason = choice.finish_reason
      const delta = choice?.delta ?? choice?.message
      if (!delta || typeof delta !== "object") continue
      if (typeof delta.content === "string" && delta.content.length > 0) out.content += delta.content
      if (typeof delta.reasoning === "string") collector.push(delta.reasoning)
      const details = Array.isArray(delta.reasoning_details) ? delta.reasoning_details : []
      for (const detail of details) {
        if (detail && typeof detail.text === "string") collector.push(detail.text)
      }
      for (const callDelta of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const index = typeof callDelta?.index === "number" ? callDelta.index : 0
        const slot = calls.get(index) ?? { id: "", name: "", arguments: "" }
        if (typeof callDelta?.id === "string" && callDelta.id) slot.id = callDelta.id
        const fn = callDelta?.function ?? {}
        if (typeof fn?.name === "string" && fn.name) slot.name += fn.name
        if (typeof fn?.arguments === "string" && fn.arguments) slot.arguments += fn.arguments
        calls.set(index, slot)
      }
    }
  }
  out.reasoning = collector.text
  out.finishReason = finishReason
  out.usage = usage
  out.toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call)
  return out
}

/** Render the per-response FULL assembled message report (human-readable view). */
export function renderResponseMarkdown(input: {
  id: string
  captured: string
  status?: number
  message: AssembledMessage
}): string {
  const lines = [
    "# Gateway response — assembled message",
    "",
    `- id: ${input.id}`,
    `- captured: ${input.captured}`,
  ]
  if (input.status !== undefined) lines.push(`- status: ${input.status}`)
  if (input.message.finishReason) lines.push(`- finish_reason: ${input.message.finishReason}`)
  const usage = input.message.usage as
    | {
        prompt_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
        completion_tokens?: number
        completion_tokens_details?: { reasoning_tokens?: number }
      }
    | undefined
  if (usage) {
    lines.push(
      `- usage: ${usage.prompt_tokens ?? "?"} prompt (${usage.prompt_tokens_details?.cached_tokens ?? 0} cached) / ${
        usage.completion_tokens ?? "?"
      } completion`,
    )
  }
  lines.push("", `## Reasoning (${input.message.reasoning.length} chars)`, "")
  lines.push(input.message.reasoning.trim() || "(empty)")
  lines.push("", `## Content (${input.message.content.length} chars)`, "")
  lines.push(input.message.content.trim() || '(empty "")')
  if (input.message.toolCalls.length > 0) {
    lines.push("", `## Tool calls (${input.message.toolCalls.length})`, "")
    for (const call of input.message.toolCalls) {
      lines.push(`- [${call.id}] ${call.name}(${call.arguments})`)
    }
  }
  lines.push("")
  return lines.join("\n")
}

type LineOp = { type: "same" | "del" | "add"; line: string }

/**
 * Unified line-based diff over literal text. Lines compare exactly — no
 * trimming, no whitespace or escape normalization — so every special
 * character stays visible. Common prefix/suffix line runs are trimmed first
 * (consecutive wire bodies share a long common prefix by construction) and
 * the LCS runs only on the changed middle; giant middles fall back to
 * whole-block -/+ emission instead of an O(n·m) table.
 */
export function renderLineDiff(input: RenderInput, context = 3): string {
  const header = `--- prev (${input.prevId})\n+++ curr (${input.currId})\n`
  if (input.prevRaw === input.currRaw) return `${header}bodies identical\n`
  const prevLines = input.prevRaw.split("\n")
  const currLines = input.currRaw.split("\n")
  const minLen = Math.min(prevLines.length, currLines.length)
  let prefix = 0
  while (prefix < minLen && prevLines[prefix] === currLines[prefix]) prefix++
  let suffix = 0
  while (
    suffix < minLen - prefix &&
    prevLines[prevLines.length - 1 - suffix] === currLines[currLines.length - 1 - suffix]
  ) {
    suffix++
  }
  const midPrev = prevLines.slice(prefix, prevLines.length - suffix)
  const midCurr = currLines.slice(prefix, currLines.length - suffix)
  // Keep up to `context` boundary lines as same-ops so hunks show their
  // surroundings even when the change sits at the trim boundary.
  const head = Math.min(prefix, context)
  const tail = Math.min(suffix, context)
  if (head > 0) {
    const ctxLines = prevLines.slice(prefix - head, prefix)
    midPrev.unshift(...ctxLines)
    midCurr.unshift(...ctxLines)
  }
  if (tail > 0) {
    const ctxLines = prevLines.slice(prevLines.length - suffix, prevLines.length - suffix + tail)
    midPrev.push(...ctxLines)
    midCurr.push(...ctxLines)
  }
  return header + renderHunks(lcsLineOps(midPrev, midCurr), prefix - head, context)
}

/** LCS over the changed middle; falls back to del-then-add when the table would explode. */
function lcsLineOps(a: string[], b: string[]): LineOp[] {
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return []
  if (n * m > 4_000_000) {
    return [
      ...a.map((line) => ({ type: "del" as const, line })),
      ...b.map((line) => ({ type: "add" as const, line })),
    ]
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!
    const next = dp[i + 1]!
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!)
    }
  }
  const ops: LineOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", line: a[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "del", line: a[i]! })
      i++
    } else {
      ops.push({ type: "add", line: b[j]! })
      j++
    }
  }
  while (i < n) ops.push({ type: "del", line: a[i++]! })
  while (j < m) ops.push({ type: "add", line: b[j++]! })
  return ops
}

/** Group ops into unified hunks with `context` unchanged lines around each change cluster. */
function renderHunks(ops: LineOp[], prefixOffset: number, context: number): string {
  const changeIdx: number[] = []
  for (let k = 0; k < ops.length; k++) if (ops[k]!.type !== "same") changeIdx.push(k)
  if (changeIdx.length === 0) return "bodies identical\n"
  const windows: Array<[number, number]> = []
  for (const idx of changeIdx) {
    const start = Math.max(0, idx - context)
    const end = Math.min(ops.length - 1, idx + context)
    const last = windows[windows.length - 1]
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else windows.push([start, end])
  }
  const out: string[] = []
  // Absolute 1-based line numbers; the common prefix lines are shared.
  let prevNo = prefixOffset
  let currNo = prefixOffset
  let k = 0
  for (const [start, end] of windows) {
    for (; k < start; k++) {
      const op = ops[k]!
      if (op.type !== "add") prevNo++
      if (op.type !== "del") currNo++
    }
    const prevStart = prevNo + 1
    const currStart = currNo + 1
    let prevCount = 0
    let currCount = 0
    const body: string[] = []
    for (; k <= end; k++) {
      const op = ops[k]!
      if (op.type === "same") {
        prevCount++
        currCount++
        prevNo++
        currNo++
        body.push(` ${op.line}`)
      } else if (op.type === "del") {
        prevCount++
        prevNo++
        body.push(`-${op.line}`)
      } else {
        currCount++
        currNo++
        body.push(`+${op.line}`)
      }
    }
    out.push(`@@ -${prevStart},${prevCount} +${currStart},${currCount} @@`, ...body)
  }
  return out.join("\n") + "\n"
}

/** Marker that identifies one reasoning-kernel copy inside a system message. */
const KERNEL_MARKER = "Semantic Vector (SV)"

function messageText(message: Record<string, unknown>): string {
  const content = message.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
          ? ((part as Record<string, unknown>).text as string)
          : "",
      )
      .join("\n")
  }
  return ""
}

/**
 * Short conformance report of the request's messages against the recommended
 * wire flow (docs/reasoning-round-trip-contract.md):
 *  - exactly ONE reasoning-kernel copy among system messages (the compaction
 *    triplication was invisible to byte diffs — the copies are identical);
 *  - assistant turns carry the single native `reasoning_content` field — no
 *    OpenRouter dual dialect (`reasoning` / `reasoning_details`);
 *  - canonical key order: reasoning_content BEFORE tool_calls;
 *  - tool-call turns always carry reasoning_content (even empty — vendors 400);
 *  - final answers without CoT omit the field entirely.
 */
export function renderIntegrityReport(input: { body: unknown }): string {
  const body = input.body
  const messages =
    body !== null && typeof body === "object" && Array.isArray((body as Record<string, unknown>).messages)
      ? ((body as Record<string, unknown>).messages as unknown[])
      : null
  if (!messages) return "integrity: body is not a JSON messages envelope — report skipped\n"
  let kernelCopies = 0
  let assistants = 0
  let canonical = 0
  const violations: string[] = []
  const roleCounts = new Map<string, number>()
  messages.forEach((item, index) => {
    if (item === null || typeof item !== "object") {
      violations.push(`[#${index}] not an object`)
      return
    }
    const message = item as Record<string, unknown>
    const role = typeof message.role === "string" ? message.role : "?"
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1)
    if (role === "system" && messageText(message).includes(KERNEL_MARKER)) kernelCopies++
    if (role !== "assistant") return
    assistants++
    let clean = true
    if ("reasoning" in message || "reasoning_details" in message) {
      violations.push(
        `[assistant#${index}] dual dialect (reasoning/reasoning_details) — single reasoning_content required`,
      )
      clean = false
    }
    const keys = Object.keys(message)
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.length : 0
    if (toolCalls > 0) {
      if (!("reasoning_content" in message)) {
        violations.push(`[assistant#${index}] tool-call turn without reasoning_content — vendor 400 (even empty)`)
        clean = false
      } else if (keys.indexOf("reasoning_content") > keys.indexOf("tool_calls")) {
        violations.push(`[assistant#${index}] reasoning_content after tool_calls — canonical order is before`)
        clean = false
      }
    } else if ("reasoning_content" in message && message.reasoning_content === "") {
      violations.push(`[assistant#${index}] empty reasoning_content on a final answer — omit the field`)
      clean = false
    }
    if (clean) canonical++
  })
  const roles = [...roleCounts.entries()].map(([role, count]) => `${role}=${count}`).join(" ")
  const head =
    `integrity: messages=${messages.length} (${roles}) | ` +
    `kernel copies: ${kernelCopies}${kernelCopies === 1 ? "" : " (EXPECTED 1 — identity accumulation)"} | ` +
    `assistant flow: canonical ${canonical}/${assistants}`
  const tail =
    violations.length === 0
      ? "integrity: CONFORMS to recommended flow"
      : `integrity: VIOLATIONS: ${violations.join("; ")}`
  return `${head}\n${tail}\n`
}
