import { describe, expect, test } from "bun:test"
import { indexedMermaidSegments, splitTextSegments } from "@/cli/cmd/tui/routes/session/text-segments"

describe("TUI text segments", () => {
  test("preserves markdown and Mermaid interleaving with original indices", () => {
    const segments = splitTextSegments(
      [
        "Before",
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```",
        "Between",
        "```mermaid",
        "sequenceDiagram",
        "  A->>B: Hello",
        "```",
        "After",
      ].join("\n"),
    )

    expect(segments.map((segment) => segment.type)).toEqual(["markdown", "mermaid", "markdown", "mermaid", "markdown"])
    expect(indexedMermaidSegments(segments).map(({ index }) => index)).toEqual([1, 3])
    expect(segments[0]).toMatchObject({ type: "markdown", text: "Before\n" })
    expect(segments[2]).toMatchObject({ type: "markdown", text: "\nBetween\n" })
    expect(segments[4]).toMatchObject({ type: "markdown", text: "\nAfter" })
  })

  test("preserves leading and trailing whitespace", () => {
    expect(splitTextSegments("  hello  ")).toEqual([{ type: "markdown", text: "  hello  " }])
  })
})
