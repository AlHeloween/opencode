export type TextSegment = { type: "markdown"; text: string } | { type: "mermaid"; raw: string; source: string }

export function splitTextSegments(text: string): TextSegment[] {
  if (!text.trim()) return []
  const input = text

  const segments: TextSegment[] = []
  const mermaidRegex =
    /(^|\r?\n)([ \t]{0,3}```mermaid(?:[ \t]+[^\r\n]*)?\r?\n([\s\S]*?)\r?\n[ \t]{0,3}```[ \t]*(?=\r?$|\r?\n))/gim
  let cursor = 0
  let match: RegExpExecArray | null = null

  while ((match = mermaidRegex.exec(input)) !== null) {
    const markdown = input.slice(cursor, match.index + match[1].length)
    if (markdown) segments.push({ type: "markdown", text: markdown })
    segments.push({ type: "mermaid", raw: match[2], source: match[3].trim() })
    cursor = mermaidRegex.lastIndex
  }

  const markdown = input.slice(cursor)
  if (markdown) segments.push({ type: "markdown", text: markdown })
  return segments.length > 0 ? segments : [{ type: "markdown", text: input }]
}

export function indexedMermaidSegments(segments: TextSegment[]) {
  return segments.flatMap((segment, index) => (segment.type === "mermaid" ? [{ index, segment }] : []))
}

/**
 * The reasoning block's visible window — an APPEND-ONLY tail (flicker plan, T1).
 *
 * MEASURED, 2026-09-22 (`routes/session/index.tsx:2116-2137` before this change): the omitted-count
 * was the FIRST markdown token and the window was `text.slice(-6_000)`, so on EVERY delta the head
 * of the rendered text changed twice — the number, then the window start. `parseMarkdownIncremental`
 * matches tokens strictly from offset 0 (`markdown-parser.ts:35-43`), so `reuseCount` collapsed to 0
 * and the whole 6 000-character tail was re-lexed per delta: an append-only stream rendered as
 * replace-head + append-tail.
 *
 * So the window start QUANTISES: it moves in blocks and only to a blank line at or after the block
 * boundary. Between rotations the rendered prefix is byte-identical and the parser reuses it. At the
 * very end (`final`) the exact tail is taken once — no deltas remain to re-lex, and the reader gets
 * the true edge — which also keeps the "latest N shown" promise literal.
 *
 * The block size is a judgement, stated as one: small enough that rotation is rare against a 25–50
 * delta/s stream, large enough that a rotation does not land mid-sentence.
 */
export const THINKING_WINDOW_BLOCK = 1_024

export function reasoningWindow(
  text: string,
  max: number,
  final: boolean,
): { start: number; omitted: number } {
  const exact = Math.max(0, text.length - max)
  if (final || exact === 0) return { start: exact, omitted: exact }
  const quantised = Math.ceil(exact / THINKING_WINDOW_BLOCK) * THINKING_WINDOW_BLOCK
  // The FIRST blank line at or after the quantum. As the stream only APPENDS, that position does not
  // move while the quantum holds — which is what makes the prefix stable rather than merely smaller.
  const blank = text.indexOf("\n\n", quantised)
  const start = Math.min(text.length, blank < 0 ? quantised : blank + 2)
  return { start, omitted: start }
}
