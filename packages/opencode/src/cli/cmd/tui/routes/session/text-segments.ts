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
