import { describe, expect, test } from "bun:test"
import { addressReport, resolveAddresses, resolveEdits } from "../../src/tool/edit"
import { chainHash, hashLabel } from "../../src/tool/read"

// t114 — edit resolves every entry against the ORIGINAL file; only true
// intersections are overlaps. RED before the fix, GREEN after.
const labels = (content: string) => {
  const out = [hashLabel(0)]
  let running = 0
  for (const line of content.split("\n")) out.push(hashLabel((running = chainHash(running, line.replace(/\r$/, "")))))
  return out
}

const linesOf = (text: string) =>
  text.split("\n").filter((_, i, arr) => !(i === arr.length - 1 && text.endsWith("\n") && text.length > 0) || true)

describe("t114 edit overlap in original coordinates", () => {
  test("(a) ClientSoft shape: insertAfter N + replace N+1..N+4 both apply, insert lands before", () => {
    const content = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n"
    const h = labels(content)
    const text = resolveEdits(content, [
      { insertAfter: h[2]!, newString: "INS" },
      { fromHash: h[3]!, toHash: h[6]!, newString: "R1\nR2" },
    ])
    expect(text).toBe("l1\nl2\nINS\nR1\nR2\nl7\nl8\n")
  })

  test("(b) replace ..N + insertAfter N both apply, insert lands after", () => {
    const content = "l1\nl2\nl3\nl4\nl5\n"
    const h = labels(content)
    const text = resolveEdits(content, [
      { fromHash: h[2]!, toHash: h[3]!, newString: "R" },
      { insertAfter: h[3]!, newString: "INS" },
    ])
    expect(text).toBe("l1\nR\nINS\nl4\nl5\n")
  })

  test("(c) two insertAfter on one hash apply in ENTRY ORDER", () => {
    const content = "a\nb\n"
    const h = labels(content)
    const text = resolveEdits(content, [
      { insertAfter: h[1]!, newString: "X" },
      { insertAfter: h[1]!, newString: "Y" },
    ])
    expect(text).toBe("a\nX\nY\nb\n")
    const swapped = resolveEdits(content, [
      { insertAfter: h[1]!, newString: "Y" },
      { insertAfter: h[1]!, newString: "X" },
    ])
    expect(swapped).toBe("a\nY\nX\nb\n")
  })

  test("(d) true overlap of two replacements is still refused", () => {
    const content = "l1\nl2\nl3\nl4\nl5\nl6\n"
    const h = labels(content)
    expect(() =>
      resolveEdits(content, [
        { fromHash: h[2]!, toHash: h[4]!, newString: "A" },
        { fromHash: h[3]!, toHash: h[5]!, newString: "B" },
      ]),
    ).toThrow(/overlap/)
  })

  test("(e) insertAfter strictly inside a replaced span is refused, naming both entries", () => {
    const content = "l1\nl2\nl3\nl4\nl5\nl6\n"
    const h = labels(content)
    let message = ""
    try {
      resolveEdits(content, [
        { fromHash: h[2]!, toHash: h[5]!, newString: "R" },
        { insertAfter: h[3]!, newString: "INS" },
      ])
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("[overlap]")
    expect(message).toContain("edit 1")
    expect(message).toContain("edit 2")
  })

  test("(f) applied spans for (a)-(c) slice the written file back correctly", () => {
    // (a)
    const contentA = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n"
    const hA = labels(contentA)
    const resA = resolveAddresses(
      contentA,
      [
        { insertAfter: hA[2]!, newString: "INS" },
        { fromHash: hA[3]!, toHash: hA[6]!, newString: "R1\nR2" },
      ],
      "\n",
      "a.txt",
    )
    if (resA.kind !== "text") throw new Error("expected text for (a): " + JSON.stringify(resA))
    const finalA = resA.text.split("\n")
    // spans are 0-based inclusive over final lines; read the written file back by slicing it.
    const sliceA = (s: number, e: number) => finalA.slice(s, e + 1).join("\n")
    expect(sliceA(resA.spans[0]!.start, resA.spans[0]!.end)).toBe("INS")
    expect(sliceA(resA.spans[1]!.start, resA.spans[1]!.end)).toBe("R1\nR2")
    expect(resA.text).toBe("l1\nl2\nINS\nR1\nR2\nl7\nl8\n")

    // (b)
    const contentB = "l1\nl2\nl3\nl4\nl5\n"
    const hB = labels(contentB)
    const resB = resolveAddresses(
      contentB,
      [
        { fromHash: hB[2]!, toHash: hB[3]!, newString: "R" },
        { insertAfter: hB[3]!, newString: "INS" },
      ],
      "\n",
      "b.txt",
    )
    if (resB.kind !== "text") throw new Error("expected text for (b)")
    const finalB = resB.text.split("\n")
    expect(finalB.slice(resB.spans[0]!.start, resB.spans[0]!.end + 1).join("\n")).toBe("R")
    expect(finalB.slice(resB.spans[1]!.start, resB.spans[1]!.end + 1).join("\n")).toBe("INS")

    // (c)
    const contentC = "a\nb\n"
    const hC = labels(contentC)
    const resC = resolveAddresses(
      contentC,
      [
        { insertAfter: hC[1]!, newString: "X" },
        { insertAfter: hC[1]!, newString: "Y" },
      ],
      "\n",
      "c.txt",
    )
    if (resC.kind !== "text") throw new Error("expected text for (c)")
    const finalC = resC.text.split("\n")
    expect(finalC.slice(resC.spans[0]!.start, resC.spans[0]!.end + 1).join("\n")).toBe("X")
    expect(finalC.slice(resC.spans[1]!.start, resC.spans[1]!.end + 1).join("\n")).toBe("Y")
    // The report over the same spans echoes the written lines with current labels.
    const report = addressReport({
      path: "c.txt",
      oldText: contentC,
      finalText: resC.text,
      spans: resC.spans,
      created: false,
      formatTouched: false,
    })
    expect(report).toContain("X")
    expect(report).toContain("Y")
    expect(linesOf).toBeDefined()
  })
})
